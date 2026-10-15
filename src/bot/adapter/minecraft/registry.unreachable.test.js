// 261015 quality pass 10: find and gather stop picking the same unreachable
// block, find prefers an exposed block over one buried in rock, and goTo/dig
// failures at a block mark it.
import { describe, it, expect, vi } from 'vitest'
import { Vec3 } from 'vec3'

vi.mock('./behaviors/visualize.js', () => ({
  visualizeAction: vi.fn(async () => ({ text: 'x', image: { mediaType: 'image/jpeg', dataBase64: 'AAAA' } })),
  __resetVisualizeDedupeCache: vi.fn(),
  CANT_SEE_COPY: "I can't see clearly right now",
  orientationToYawOffset: vi.fn(() => null),
  yawToUnit: vi.fn(() => [0, -1]),
  faceYaw: vi.fn(async () => {}),
  captureFrame: vi.fn(async () => ({ ok: true, mediaType: 'image/jpeg', dataBase64: 'AAAA' })),
}))

const goToMock = vi.fn(async () => 'reached')
vi.mock('./behaviors/pathfind.js', async (orig) => ({ ...(await orig()), goTo: (...a) => goToMock(...a) }))
const digMock = vi.fn(async () => 'dug')
vi.mock('./behaviors/dig.js', async (orig) => ({ ...(await orig()), digAction: (...a) => digMock(...a) }))

const { createDefaultRegistry } = await import('./registry.js')
const { noteUnreachable, isUnreachable } = await import('./behaviors/unreachable.js')
const { gatherAction } = await import('./behaviors/mineVein.js')

// Voxel world: named blocks in `blocks`; stone fills everything at y<=64,
// air above.
function makeBot(blockList, at = new Vec3(0.5, 65, 0.5)) {
  const blocks = new Map(blockList.map(([x, y, z, n]) => [`${x},${y},${z}`, n]))
  const bot = {
    version: '1.21.1',
    entity: { position: at, onGround: true },
    entities: {},
    players: {},
    blockAt(p) {
      const name = blocks.get(`${p.x},${p.y},${p.z}`) ?? (p.y <= 64 ? 'stone' : 'air')
      return { name, position: p, boundingBox: name === 'air' ? 'empty' : 'block' }
    },
    findBlocks({ count, matching }) {
      const want = new Set(Array.isArray(matching) ? matching.map((id) => bot._ids[id]) : [])
      const hits = []
      for (const [k, name] of blocks) {
        if (want.size && !want.has(name)) continue
        const [x, y, z] = k.split(',').map(Number)
        hits.push(new Vec3(x, y, z))
      }
      hits.sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position))
      return hits.slice(0, count ?? 1)
    },
  }
  const mcData = require('minecraft-data')('1.21.1')
  bot._ids = Object.fromEntries(Object.values(mcData.blocks).map((b) => [b.id, b.name]))
  return { bot, blocks }
}
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

describe('find (261015)', () => {
  it('prefers an exposed ore over a nearer one buried in stone', async () => {
    const reg = createDefaultRegistry()
    // Buried coal 7 down (distance ~7.6), exposed coal on the surface ~14 away.
    const { bot } = makeBot([[0, 58, 3, 'coal_ore'], [14, 65, 3, 'coal_ore']])
    const r = await reg.execute('find', { name: 'coal_ore' }, bot, {})
    expect(r).toMatchObject({ found: true, id: 'coal_ore', pos: { x: 14, y: 65, z: 3 } })
  })

  it('prefers a surface ore over a slightly nearer exposed one deep below (cave wall)', async () => {
    const reg = createDefaultRegistry()
    // A cave pocket around the deep ore makes it "exposed".
    const { bot } = makeBot([[4, 48, 10, 'coal_ore'], [4, 48, 11, 'air'], [22, 65, 10, 'coal_ore']])
    const r = await reg.execute('find', { name: 'coal_ore' }, bot, {})
    expect(r.pos).toEqual({ x: 22, y: 65, z: 10 })
  })

  it('still finds the buried one when it is much nearer', async () => {
    const reg = createDefaultRegistry()
    const { bot } = makeBot([[0, 62, 1, 'coal_ore'], [40, 65, 3, 'coal_ore']])
    const r = await reg.execute('find', { name: 'coal_ore' }, bot, {})
    expect(r.pos).toEqual({ x: 0, y: 62, z: 1 })
  })

  it('skips a block (and its trunk) it could not reach recently, and says so', async () => {
    const reg = createDefaultRegistry()
    const { bot } = makeBot([
      [4, 71, 0, 'oak_log'], [4, 72, 0, 'oak_log'], [4, 73, 0, 'oak_log'],
      [-10, 65, 0, 'oak_log'],
    ])
    noteUnreachable(bot, { x: 4, y: 71, z: 0 })
    const r = await reg.execute('find', { name: 'oak_log' }, bot, {})
    expect(r).toMatchObject({ found: true, pos: { x: -10, y: 65, z: 0 } })
    expect(r.note).toBe('skipped 3 you could not reach recently')
  })

  it('answers honestly when every one in range was unreachable', async () => {
    const reg = createDefaultRegistry()
    const { bot } = makeBot([[4, 71, 0, 'oak_log']])
    noteUnreachable(bot, { x: 4, y: 71, z: 0 })
    const r = await reg.execute('find', { name: 'oak_log' }, bot, {})
    expect(r.found).toBe(false)
    expect(r.reason).toMatch(/could not reach in the last few minutes/)
  })
})

describe('goTo and dig mark unreachable blocks (261015)', () => {
  it('a failed goTo at a block marks it; at a player or empty spot it does not', async () => {
    const reg = createDefaultRegistry()
    const { bot } = makeBot([[4, 71, 0, 'oak_log']], new Vec3(1.5, 65, 0.5))
    goToMock.mockResolvedValueOnce('cant_reach (closest=6.5m to target 4,71,0)')
    await reg.execute('goTo', { x: 4, y: 71, z: 0, range: 2 }, bot, {})
    expect(isUnreachable(bot, { x: 4, y: 71, z: 0 })).toBe(true)

    const { bot: bot2 } = makeBot([], new Vec3(1.5, 65, 0.5))
    goToMock.mockResolvedValueOnce('cant_reach (closest=6.5m to target 4,71,0)')
    await reg.execute('goTo', { x: 4, y: 71, z: 0, range: 2 }, bot2, {})
    expect(isUnreachable(bot2, { x: 4, y: 71, z: 0 })).toBe(false)
  })

  it('a timeout far from the block is not held against it', async () => {
    const reg = createDefaultRegistry()
    const { bot } = makeBot([[40, 65, 0, 'oak_log']])
    goToMock.mockResolvedValueOnce('timeout')
    await reg.execute('goTo', { x: 40, y: 65, z: 0, range: 2 }, bot, {})
    expect(isUnreachable(bot, { x: 40, y: 65, z: 0 })).toBe(false)
  })

  it('an out-of-range dig from right beside the block marks it, from far away it does not', async () => {
    const reg = createDefaultRegistry()
    const { bot } = makeBot([[4, 71, 0, 'oak_log'], [30, 65, 0, 'iron_ore']])
    digMock.mockResolvedValueOnce('out of range (5.7m, need ≤4.5) for oak_log @4,71,0')
    await reg.execute('dig', { x: 4, y: 71, z: 0 }, bot, {})
    expect(isUnreachable(bot, { x: 4, y: 71, z: 0 })).toBe(true)
    digMock.mockResolvedValueOnce('out of range (29.6m, need ≤4.5) for iron_ore @30,65,0')
    await reg.execute('dig', { x: 30, y: 65, z: 0 }, bot, {})
    expect(isUnreachable(bot, { x: 30, y: 65, z: 0 })).toBe(false)
  })
})

describe('gather skips blocks it could not reach recently (261015)', () => {
  it('re-anchors on a different tree, and a later out-of-range dig is remembered', async () => {
    const { bot, blocks } = makeBot([[2, 65, 0, 'oak_log'], [9, 65, 0, 'oak_log']])
    noteUnreachable(bot, { x: 2, y: 65, z: 0 })
    const deps = {
      goTo: vi.fn(async () => 'reached'),
      digAction: vi.fn(async ({ x, y, z }) => { blocks.delete(`${x},${y},${z}`); return 'dug oak_log' }),
    }
    const r = await gatherAction({ name: 'oak_log', count: 1 }, bot, {}, deps)
    expect(r).toMatch(/^gathered 1\/1 oak_log/)
    expect(deps.digAction).toHaveBeenCalledWith({ x: 9, y: 65, z: 0 }, bot, {})
  })

  it('says so when every block in range was unreachable', async () => {
    const { bot } = makeBot([[2, 65, 0, 'oak_log']])
    noteUnreachable(bot, { x: 2, y: 65, z: 0 })
    const deps = { goTo: vi.fn(), digAction: vi.fn() }
    const r = await gatherAction({ name: 'oak_log', count: 3 }, bot, {}, deps)
    expect(r).toMatch(/^gathered 0\/3 oak_log: every oak_log nearby \(1\) is one you could not reach/)
    expect(deps.digAction).not.toHaveBeenCalled()
  })

  it('remembers a block that stayed out of range after the walk', async () => {
    const { bot } = makeBot([[2, 70, 0, 'oak_log']])
    const deps = {
      goTo: vi.fn(async () => 'cant_reach'),
      digAction: vi.fn(async () => 'out of range (5.7m, need ≤4.5) for oak_log @2,70,0'),
    }
    await gatherAction({ name: 'oak_log', count: 1 }, bot, {}, deps)
    expect(isUnreachable(bot, { x: 2, y: 70, z: 0 })).toBe(true)
  })
})
