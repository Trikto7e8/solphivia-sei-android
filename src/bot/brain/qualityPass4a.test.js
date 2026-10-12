// 261012: quality pass 4a, protect_player target selection.
//  - a hostile asked for by name resolves to the one nearest the OWNER, also
//    past the old 16-block name bound, while the owner is under threat
//  - a mob already at her feet still wins over one that is not on them yet
//  - after a kill with swings left, attackEntity goes on to the next hostile
//    near the owner
//  - in an owner defense, a second hostile next to her gets one hit
//  - the reflex does not strafe around another mob during a committed attack

import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { attackEntityAction } from '../adapter/minecraft/behaviors/attack.js'
import { resolveEntity, pickHostileForOwner, ownerEntityOf } from '../adapter/minecraft/observers/targeting.js'

const vec = (x, y, z) => ({
  x, y, z,
  distanceTo(p) { return Math.hypot(p.x - this.x, p.y - this.y, p.z - this.z) },
  offset(dx, dy, dz) { return vec(this.x + dx, this.y + dy, this.z + dz) },
})

// Her at x=0, the owner Alex at `ownerX`, mobs along the x axis.
function world(mobs = [], { ownerX = 4, owner = true } = {}) {
  const bot = new EventEmitter()
  bot.entity = { id: 1, position: vec(0, 64, 0) }
  bot.entities = { 1: bot.entity }
  bot._seiOwnerNames = owner ? ['alex'] : []
  const alex = { id: 2, username: 'Alex', type: 'player', position: vec(ownerX, 64, 0) }
  bot.entities[2] = alex
  bot.players = { Alex: { entity: alex } }
  for (const m of mobs) bot.entities[m.id] = { type: 'hostile', height: 1.95, ...m, position: vec(m.x, 64, m.z ?? 0) }
  bot.nearestEntity = (match) => Object.values(bot.entities)
    .filter((e) => e !== bot.entity && match(e))
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0] ?? null
  return bot
}

describe('owner-aware hostile pick', () => {
  it('finds the owner from the recorded names', () => {
    expect(ownerEntityOf(world())?.username).toBe('Alex')
    expect(ownerEntityOf(world([], { owner: false }))).toBeNull()
  })

  it('a by-name attack goes for the zombie nearest the owner, not nearest her', () => {
    // Owner 20 blocks out; zombie 21 is 6 from her, zombie 22 is on the owner.
    const bot = world([{ id: 21, name: 'zombie', x: -6 }, { id: 22, name: 'zombie', x: 22 }], { ownerX: 20 })
    expect(resolveEntity({ entity: 'zombie' }, bot)?.id).toBe(22)
  })

  it('reaches past the old 16-block name bound when the mob is near the owner', () => {
    // protect_player at the order: her and the owner together, zombies 21-25 out.
    const bot = world([{ id: 21, name: 'zombie', x: -25, z: -3 }, { id: 22, name: 'zombie', x: -26, z: 3 }], { ownerX: -4 })
    expect(resolveEntity({ target: 'zombie' }, bot)?.id).toBe(21)
  })

  it('a zombie at her feet beats one that is not on the owner yet', () => {
    const bot = world([{ id: 21, name: 'zombie', x: 2 }, { id: 22, name: 'zombie', x: 30 }], { ownerX: 18 })
    expect(pickHostileForOwner(bot)?.id).toBe(21)
  })

  it('...but not one that is on the owner', () => {
    const bot = world([{ id: 21, name: 'zombie', x: 2 }, { id: 22, name: 'zombie', x: 21 }], { ownerX: 18 })
    expect(pickHostileForOwner(bot)?.id).toBe(22)
  })

  it('keeps the old nearest-to-her rule when the owner is unknown', () => {
    const bot = world([{ id: 21, name: 'zombie', x: -6 }, { id: 22, name: 'zombie', x: 12 }], { owner: false })
    expect(resolveEntity({ entity: 'zombie' }, bot)?.id).toBe(21)
  })

  it('does not apply to non-hostiles (a sheep is still the nearest one)', () => {
    const bot = world([{ id: 21, name: 'sheep', x: -3 }, { id: 22, name: 'sheep', x: 5 }], { ownerX: 6 })
    expect(resolveEntity({ entity: 'sheep' }, bot)?.id).toBe(21)
  })
})

function fightable(bot) {
  bot.health = 20
  bot.heldItem = { name: 'iron_sword' }
  bot.inventory = { items: () => [{ name: 'iron_sword' }] }
  bot.lookAt = vi.fn()
  bot.swingArm = vi.fn()
  bot.equip = vi.fn()
  bot.attack = vi.fn()
  bot.setControlState = vi.fn()
  bot.pathfinder = { goal: null, setGoal: vi.fn((g) => { bot.pathfinder.goal = g }), setMovements: vi.fn() }
  return bot
}

describe('attackEntity after a kill (owner defense)', () => {
  it('goes on to the next hostile near the owner while swings remain', async () => {
    const bot = fightable(world([{ id: 21, name: 'zombie', x: 2 }, { id: 22, name: 'zombie', x: 3, z: 1 }], { ownerX: 4 }))
    const hits = []
    bot.attack.mockImplementation((e) => {
      hits.push(e.id)
      // each zombie dies on its second hit
      if (hits.filter((x) => x === e.id).length === 2) { bot.emit('entityDead', { id: e.id }); delete bot.entities[e.id] }
    })
    const r = await attackEntityAction({ target: 'zombie', times: 8 }, bot, {})
    expect(r).toMatch(/killed zombie/)
    expect(r).toContain('Then went for the next zombie: killed zombie')
    expect(new Set(hits)).toEqual(new Set([21, 22]))
    expect(bot._seiOffensiveTarget ?? null).toBeNull()
  })

  it('stops after the kill when nothing else is near the owner', async () => {
    const bot = fightable(world([{ id: 21, name: 'zombie', x: 2 }, { id: 22, name: 'zombie', x: -40 }], { ownerX: 4 }))
    bot.attack.mockImplementation((e) => { bot.emit('entityDead', { id: e.id }); delete bot.entities[e.id] })
    const r = await attackEntityAction({ target: 'zombie', times: 8 }, bot, {})
    expect(r).toBe('killed zombie (1 hits)')
    expect(bot.attack).toHaveBeenCalledTimes(1)
  })

  it('does not chain a hunt (a sheep kill is just a kill)', async () => {
    const bot = fightable(world([{ id: 21, name: 'sheep', x: 2 }, { id: 22, name: 'zombie', x: 3 }], { ownerX: 4 }))
    bot.attack.mockImplementation((e) => { bot.emit('entityDead', { id: e.id }); delete bot.entities[e.id] })
    const r = await attackEntityAction({ entity: 'sheep', times: 5 }, bot, {})
    expect(r).toBe('killed sheep (1 hits)')
  })

  it('gives a second hostile next to her one hit during the fight', async () => {
    const bot = fightable(world([{ id: 21, name: 'zombie', x: 2 }, { id: 22, name: 'zombie', x: 1, z: 2 }], { ownerX: 6 }))
    const hits = []
    bot.attack.mockImplementation((e) => {
      hits.push(e.id)
      if (e.id === 21 && hits.filter((x) => x === 21).length === 3) { bot.emit('entityDead', { id: 21 }); delete bot.entities[21] }
    })
    const r = await attackEntityAction({ target: 'zombie', times: 3 }, bot, {})
    // 21, then one tag on 22, then 21 twice more (the kill).
    expect(hits).toEqual([21, 22, 21, 21])
    expect(r).toContain('killed zombie (3 hits)')
    expect(r).toContain('You also hit another hostile once on the way')
  })
})

describe('reflex melee strafe during a committed attack', () => {
  it('does not strafe around a different mob', async () => {
    const { startReflex } = await import('../adapter/minecraft/behaviors/reflex.js')
    const bot = world([{ id: 21, name: 'zombie', x: 3 }], { ownerX: 10 })
    // No pitch: the field-of-view gate fails open, so the zombie counts as seen.
    bot.entity.yaw = Math.PI / 2
    bot.entity.velocity = vec(0, 0, 0)
    bot.health = 20
    bot.setControlState = vi.fn()
    bot.lookAt = vi.fn()
    bot.clearControlStates = vi.fn()
    bot._seiOffensiveTarget = 99 // committed to some other mob
    const dispose = startReflex(bot, {})
    bot.emit('physicsTick')
    expect(bot.setControlState.mock.calls.filter(([, on]) => on === true)).toHaveLength(0)
    bot._seiOffensiveTarget = null
    bot.emit('physicsTick')
    expect(bot.setControlState.mock.calls.filter(([, on]) => on === true).length).toBeGreaterThan(0)
    dispose?.()
  })
})

// ── Issue 2 + 3: tool tiers, recipe counts, progress and inventory wording ──
import { SPINE, recipeNote, pickaxeLine } from '../adapter/minecraft/observers/progression.js'
import { getInFlightLineForSnapshot } from './inflight.js'
import { CAPABILITY_PARAGRAPH } from './promptLibrary.js'

describe('what a pickaxe mines', () => {
  it('says plainly that a wooden pickaxe mines stone', () => {
    expect(CAPABILITY_PARAGRAPH).toContain('A wooden pickaxe mines stone (it drops cobblestone)')
    expect(CAPABILITY_PARAGRAPH).not.toContain('you cannot skip a rung')
  })

  it('the stone pickaxe step says the wooden pickaxe mines the stone', () => {
    const node = SPINE.find((n) => n.id === 'stone_pickaxe')
    expect(node.next_action).toMatch(/^mine stone with the wooden pickaxe/)
  })
})

describe('recipe on the next: line', () => {
  const stone = SPINE.find((n) => n.id === 'stone_pickaxe')

  it('gives the counts and what she holds', () => {
    const r = recipeNote(stone, { wooden_pickaxe: 1, cobblestone: 2, oak_planks: 2 })
    expect(r).toContain('Recipe: 3 cobblestone + 2 sticks at a crafting table.')
    expect(r).toContain('You have 2 cobblestone, 0 sticks, 2 planks, 0 logs')
  })

  it('drops the log note once the sticks are there', () => {
    expect(recipeNote(stone, { cobblestone: 5, stick: 4 })).toBe('Recipe: 3 cobblestone + 2 sticks at a crafting table. You have 5 cobblestone, 4 sticks.')
  })

  it('counts any kind of planks', () => {
    const table = SPINE.find((n) => n.id === 'crafting_table')
    expect(recipeNote(table, { oak_planks: 2, birch_planks: 2 })).toBe('Recipe: 4 planks. You have 4 planks.')
  })

  it('is empty for a node without a recipe', () => {
    expect(recipeNote(SPINE.find((n) => n.id === 'diamonds'), {})).toBe('')
  })
})

describe('in_flight progress wording', () => {
  it('spells out a dig count instead of a fraction', () => {
    const line = getInFlightLineForSnapshot({ name: 'gather', args: { name: 'oak_log', count: 6 }, startedAt: 0, progress: { dug: 1, total: 6 } }, 1000)
    expect(line).toContain('broke 1 of the 6 blocks asked for so far')
    expect(line).not.toContain('1/6')
  })

  it('spells out a place count', () => {
    const line = getInFlightLineForSnapshot({ name: 'build', args: {}, startedAt: 0, progress: { placed: 3, total: 10 } }, 1000)
    expect(line).toContain('placed 3 of 10 so far')
  })
})

describe('pickaxe line under the inventory', () => {
  it('says what the best pickaxe she holds mines', () => {
    expect(pickaxeLine({ wooden_pickaxe: 1, dirt: 2 })).toBe('pickaxe: wooden_pickaxe mines stone (it drops cobblestone) and coal ore. Iron, copper and lapis ore need a stone pickaxe.')
    expect(pickaxeLine({ wooden_pickaxe: 1, iron_pickaxe: 1 })).toMatch(/^pickaxe: iron_pickaxe mines every ore\./)
  })

  it('says when she has none', () => {
    expect(pickaxeLine({ oak_log: 3 })).toMatch(/^pickaxe: none, so stone and ore drop nothing/)
  })
})
