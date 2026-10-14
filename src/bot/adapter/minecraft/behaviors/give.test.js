// src/bot/adapter/minecraft/behaviors/give.test.js
//
// 261015: give hands items to the player in one call: walk into tossing range
// when needed, face them, toss, and say how many left the inventory.

import { describe, it, expect } from 'vitest'
import { Vec3 } from 'vec3'
import { giveAction, resolveRecipient, HAND_RANGE } from './give.js'

function makeBot({ at = new Vec3(0, 64, 0), player = new Vec3(2, 64, 0), inv = [{ name: 'coal', count: 8 }], players } = {}) {
  const items = inv.map((i) => ({ ...i }))
  const looks = []
  const bot = {
    username: 'Sui',
    entity: { position: at },
    inventory: { items: () => items },
    players: players ?? { SSk1tz: { username: 'SSk1tz', entity: player ? { position: player } : null } },
    lookAt: async (p) => { looks.push(p) },
  }
  return { bot, items, looks }
}

function deps(bot, items, { walkTo } = {}) {
  const walked = []
  const dropped = []
  return {
    walked,
    dropped,
    goTo: async (_bot, x, y, z) => {
      walked.push([x, y, z])
      if (walkTo !== null) bot.entity.position = walkTo ?? new Vec3(x - 1, y, z)
      return walkTo === null ? 'cant_reach' : 'reached'
    },
    drop: async ({ item, count }) => {
      dropped.push({ item, count })
      const it = items.find((i) => i.name === item)
      const n = Math.min(count, it?.count ?? 0)
      if (it) it.count -= n
      return `dropped ${n} ${item}`
    },
  }
}

const cfg = { player_username: 'Alex', pathfinder_timeout_ms: 1000 }

describe('giveAction', () => {
  it('tosses everything of the item when the player is close, facing them first', async () => {
    const { bot, items, looks } = makeBot()
    const d = deps(bot, items)
    const r = await giveAction({ item: 'coal' }, bot, cfg, d)
    expect(d.walked).toEqual([])
    expect(d.dropped).toEqual([{ item: 'coal', count: 8 }])
    expect(looks.length).toBe(1)
    expect(r).toBe('gave 8 coal to Alex, tossed at their feet; you have 0 coal left')
  })

  it('gives only the count asked for, capped at what she has', async () => {
    const { bot, items } = makeBot()
    const d = deps(bot, items)
    expect(await giveAction({ item: 'coal', count: 3 }, bot, cfg, d)).toBe('gave 3 coal to Alex, tossed at their feet; you have 5 coal left')
    expect(d.dropped).toEqual([{ item: 'coal', count: 3 }])
    const r = await giveAction({ item: 'coal', count: 64 }, bot, cfg, d)
    expect(d.dropped[1]).toEqual({ item: 'coal', count: 5 })
    expect(r).toContain('gave 5 coal')
  })

  it('walks over first when the player is out of tossing range', async () => {
    const { bot, items } = makeBot({ player: new Vec3(14, 64, 0) })
    const d = deps(bot, items)
    const r = await giveAction({ item: 'coal', count: 8 }, bot, cfg, d)
    expect(d.walked).toEqual([[14, 64, 0]])
    expect(d.dropped.length).toBe(1)
    expect(r).toContain('gave 8 coal to Alex')
  })

  it('keeps the items when it cannot reach the player, and says so', async () => {
    const { bot, items } = makeBot({ player: new Vec3(HAND_RANGE + 10, 64, 0) })
    const d = deps(bot, items, { walkTo: null })
    const r = await giveAction({ item: 'coal' }, bot, cfg, d)
    expect(d.dropped).toEqual([])
    expect(r).toBe('could not get to Alex (cant_reach), so nothing was given; you still have 8 coal')
  })

  it('refuses when she has none of the item or cannot see the player', async () => {
    const a = makeBot()
    expect(await giveAction({ item: 'diamond' }, a.bot, cfg, deps(a.bot, a.items))).toBe('no diamond in your inventory, nothing was given')
    const b = makeBot({ player: null })
    const d = deps(b.bot, b.items)
    expect(await giveAction({ item: 'coal' }, b.bot, cfg, d)).toContain('cannot see Alex nearby, so nothing was given; you still have 8 coal')
    expect(d.dropped).toEqual([])
  })

  it('does nothing once aborted', async () => {
    const { bot, items } = makeBot()
    const d = deps(bot, items)
    const ac = new AbortController()
    ac.abort()
    expect(await giveAction({ item: 'coal' }, bot, { ...cfg, signal: ac.signal }, d)).toBe('aborted')
    expect(d.dropped).toEqual([])
  })
})

describe('resolveRecipient', () => {
  const players = { SSk1tz: { username: 'SSk1tz', entity: {} }, Lyra: { username: 'Lyra', entity: {} } }

  it('maps the name she calls the player to their LAN login', () => {
    expect(resolveRecipient({ username: 'Sui', players: { SSk1tz: players.SSk1tz } }, 'alex', cfg)?.username).toBe('SSk1tz')
  })

  it('never falls back to a sibling companion when the player is offline', () => {
    const lyraOnly = { username: 'Sui', players: { Lyra: players.Lyra } }
    expect(resolveRecipient(lyraOnly, 'Alex', { ...cfg, _seiCompanions: ['Lyra'] })).toBeNull()
    // Without the roster, Lyra looks like the one human online.
    expect(resolveRecipient(lyraOnly, 'Alex', cfg)?.username).toBe('Lyra')
    // With the player online beside a companion, the player still resolves.
    const both = { username: 'Sui', players }
    expect(resolveRecipient(both, 'Alex', { ...cfg, _seiCompanions: ['Lyra'] })?.username).toBe('SSk1tz')
  })

  it('finds anyone else only by their own name, never the lone-human fallback', () => {
    const bot = { username: 'Sui', players }
    expect(resolveRecipient(bot, 'lyra', cfg)?.username).toBe('Lyra')
    expect(resolveRecipient({ username: 'Sui', players: { SSk1tz: players.SSk1tz } }, 'Marv', cfg)).toBeNull()
  })
})
