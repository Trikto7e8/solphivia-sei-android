// weakWeaponNote (260708) — when a mob survives the batch and the bot is not
// holding a real weapon, the result string must say so and point at the right
// fix: equip the weapon already in the inventory if one exists, otherwise
// craft one (Lyra fought a zombie and a skeleton with a stick while the player
// died twice; nothing ever told the model the stick was the problem).

import { describe, it, expect, vi } from 'vitest'
import { Vec3 } from 'vec3'
import { weakWeaponNote, attackEntityAction, goneResult, CRITICAL_HP } from './attack.js'

function makeBot({ held = null, items = [] } = {}) {
  return {
    heldItem: held ? { name: held } : null,
    inventory: { items: () => items.map(name => ({ name })) },
  }
}

describe('weakWeaponNote', () => {
  it('is silent when a real weapon is held', () => {
    expect(weakWeaponNote(makeBot({ held: 'wooden_sword' }))).toBe('')
    expect(weakWeaponNote(makeBot({ held: 'iron_axe' }))).toBe('')
  })

  it('a pickaxe is NOT a weapon (the _axe match must not catch it)', () => {
    const n = weakWeaponNote(makeBot({ held: 'wooden_pickaxe' }))
    expect(n).toContain('wooden_pickaxe')
    expect(n).toContain('slow')
  })

  it('points at the inventory weapon when one exists but is not equipped', () => {
    const n = weakWeaponNote(makeBot({ held: 'stick', items: ['oak_planks', 'stone_sword'] }))
    expect(n).toContain("fighting with stick")
    expect(n).toContain('equip your stone_sword')
  })

  it('suggests crafting when no weapon exists anywhere', () => {
    const n = weakWeaponNote(makeBot({ held: 'stick', items: ['oak_planks'] }))
    expect(n).toContain('craft a weapon')
  })

  it('handles empty hands and a missing inventory', () => {
    const n = weakWeaponNote({ heldItem: null })
    expect(n).toContain('bare hands')
    expect(n).toContain('craft a weapon')
  })
})

// 261011 quality pass 2: critical health and the weapon staying in hand.
function fightBot({ health = 20, held = 'stone_sword', items = ['stone_sword', 'bread'] } = {}) {
  const zombie = { id: 7, name: 'zombie', type: 'hostile', position: new Vec3(1, 64, 0), height: 1.95 }
  const bot = {
    health,
    entity: { position: new Vec3(0, 64, 0) },
    entities: { 7: zombie },
    heldItem: held ? { name: held } : null,
    inventory: { items: () => items.map((name) => ({ name })) },
    lookAt: vi.fn(),
    swingArm: vi.fn(),
    attack: vi.fn(),
    equip: vi.fn(async (item) => { bot.heldItem = { name: item.name } }),
  }
  return bot
}

describe('attackEntity at critical health (261011)', () => {
  it('does not start a mob fight at critical health, and says what to do instead', async () => {
    const bot = fightBot({ health: CRITICAL_HP - 2 })
    const r = await attackEntityAction({ entity_id: 7, times: 3 }, bot, {})
    expect(r).toMatch(/^did not attack zombie: you are at 4 health/)
    expect(r).toMatch(/Get away first/)
    expect(bot.attack).not.toHaveBeenCalled()
  })

  it('stops trading hits once the fight brings her to critical health', async () => {
    const bot = fightBot()
    bot.attack.mockImplementation(() => { bot.health = 5 })
    const r = await attackEntityAction({ entity_id: 7, times: 3 }, bot, {})
    expect(bot.attack).toHaveBeenCalledTimes(1)
    expect(r).toMatch(/^1\/3 hits on zombie, then stopped: you are down to 5 health/)
  })

  it('puts the weapon back before the next swing when the hand changed mid-fight', async () => {
    const bot = fightBot()
    bot.attack.mockImplementationOnce(() => { bot.heldItem = { name: 'bread' } })
    await attackEntityAction({ entity_id: 7, times: 2 }, bot, {})
    expect(bot.attack).toHaveBeenCalledTimes(2)
    expect(bot.equip).toHaveBeenCalledTimes(1)
    expect(bot.equip.mock.calls[0][0].name).toBe('stone_sword')
  })
})

// 261011 quality pass 2: a mob leaving the entity table is not a kill.
describe('attackEntity reports death only on the death event (261011)', () => {
  function withEvents(bot) {
    const handlers = {}
    bot.on = vi.fn((ev, fn) => { (handlers[ev] ??= []).push(fn) })
    bot.removeListener = vi.fn((ev, fn) => { handlers[ev] = (handlers[ev] ?? []).filter((h) => h !== fn) })
    bot.emit = (ev, arg) => (handlers[ev] ?? []).forEach((h) => h(arg))
    bot.handlers = handlers
    return bot
  }

  it('says killed when the server reported the death', async () => {
    const bot = withEvents(fightBot())
    bot.attack.mockImplementation(() => { bot.emit('entityDead', { id: 7 }); delete bot.entities[7] })
    const r = await attackEntityAction({ entity_id: 7, times: 3 }, bot, {})
    expect(r).toBe('killed zombie (1 hits)')
    expect(bot.handlers.entityDead).toHaveLength(0) // listener removed
  })

  it('says lost sight, not killed, when the mob just left the entity table', async () => {
    const bot = withEvents(fightBot())
    bot.attack.mockImplementation(() => { delete bot.entities[7] })
    const r = await attackEntityAction({ entity_id: 7, times: 3 }, bot, {})
    expect(r).toMatch(/^1 hits on zombie, then lost sight of zombie: .*NOT confirmed dead/)
    expect(r).not.toMatch(/killed/)
  })

  it('stops swinging once the death event arrives, while the corpse is still listed', async () => {
    const bot = withEvents(fightBot())
    bot.attack.mockImplementation(() => { bot.emit('entityDead', { id: 7 }) }) // entity stays in the table
    const r = await attackEntityAction({ entity_id: 7, times: 3 }, bot, {})
    expect(bot.attack).toHaveBeenCalledTimes(1)
    expect(r).toBe('killed zombie (1 hits)')
  })

  it('counts a kill on the last swing', async () => {
    const bot = withEvents(fightBot())
    bot.attack.mockImplementation(() => { setTimeout(() => { bot.emit('entityDead', { id: 7 }) }, 50) })
    const r = await attackEntityAction({ entity_id: 7, times: 1 }, bot, {})
    expect(r).toBe('killed zombie (1 hits)')
  })

  it('names the mob when none is in range', async () => {
    const bot = withEvents(fightBot())
    bot.entities = {}
    bot.nearestEntity = () => null
    expect(await attackEntityAction({ entity: 'zombie' }, bot, {})).toBe('no zombie within 16 blocks to attack')
  })

  it('goneResult wording', () => {
    expect(goneResult('skeleton', 0, true)).toBe('skeleton died before you hit it')
    expect(goneResult('skeleton', 0, false)).toMatch(/^lost sight of skeleton/)
  })
})
