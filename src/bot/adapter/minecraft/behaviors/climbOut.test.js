// 261015 quality pass 10: climbing out of a self-dug 1x1 shaft, and the
// short memory of unreachable targets.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Vec3 } from 'vec3'

const scaffoldUp = vi.fn()
vi.mock('./build.js', () => ({ scaffoldUp: (...a) => scaffoldUp(...a) }))

const { pitInfo, climbOut, junkBlocks, isPassable } = await import('./climbOut.js')
const { noteUnreachable, isUnreachable, isUnreachableResult, clearUnreachable, UNREACHABLE_TTL_MS } = await import('./unreachable.js')

// Voxel world: solid stone everywhere at or below `ground`, air above, minus
// the cells in `air`, plus extra solid cells in `solid`.
function makeWorld({ ground = 70, air = [], solid = [] } = {}) {
  const airSet = new Set(air.map((c) => c.join(',')))
  const solidSet = new Set(solid.map((c) => c.join(',')))
  return (p) => {
    const k = `${p.x},${p.y},${p.z}`
    const isSolid = solidSet.has(k) || (!airSet.has(k) && p.y <= ground)
    return isSolid
      ? { name: 'stone', boundingBox: 'block', position: p }
      : { name: 'air', boundingBox: 'empty', position: p }
  }
}

// A 1x1 shaft at (0,0) dug from y=70 down to y=70-depth+1; the bot stands
// on its floor.
function shaftBot(depth, { items = [], ground = 70 } = {}) {
  const air = []
  for (let y = ground; y > ground - depth; y--) air.push([0, y, 0])
  const bot = {
    entity: { position: new Vec3(0.5, ground - depth + 1, 0.5), onGround: true },
    blockAt: makeWorld({ ground, air }),
    inventory: { items: () => items },
    setControlState: vi.fn(),
  }
  return bot
}

beforeEach(() => { scaffoldUp.mockReset() })

describe('pitInfo', () => {
  it('finds the rim of a 1x1 shaft the bot stands in', () => {
    const bot = shaftBot(4)
    const pit = pitInfo(bot)
    expect(pit).toMatchObject({ feetY: 67, rimY: 71, depth: 4 })
  })

  it('is null when a side cell is open at feet level (she can walk out)', () => {
    const bot = shaftBot(4)
    const world = bot.blockAt
    bot.blockAt = (p) => (p.x === 1 && p.z === 0 && (p.y === 67 || p.y === 68))
      ? { name: 'air', boundingBox: 'empty' }
      : world(p)
    expect(pitInfo(bot)).toBeNull()
  })

  it('reports a roofed shaft without a rim', () => {
    const bot = shaftBot(4)
    const world = bot.blockAt
    bot.blockAt = (p) => (p.x === 0 && p.z === 0 && p.y === 70) ? { name: 'dirt', boundingBox: 'block' } : world(p)
    expect(pitInfo(bot)).toMatchObject({ rimY: null, ceilingY: 70 })
  })

  it('treats grass and water as passable but not lava', () => {
    expect(isPassable({ name: 'short_grass', boundingBox: 'empty' })).toBe(true)
    expect(isPassable({ name: 'water', boundingBox: 'empty' })).toBe(true)
    expect(isPassable({ name: 'lava', boundingBox: 'empty' })).toBe(false)
    expect(isPassable({ name: 'stone', boundingBox: 'block' })).toBe(false)
  })
})

describe('junkBlocks', () => {
  it('lists cheap scaffold blocks, most plentiful first, minus kept items', () => {
    const bot = { inventory: { items: () => [
      { name: 'dirt', count: 3 }, { name: 'andesite', count: 9 }, { name: 'oak_planks', count: 20 },
      { name: 'cobblestone', count: 5 }, { name: 'diamond', count: 2 },
    ] } }
    expect(junkBlocks(bot).map((b) => b.name)).toEqual(['andesite', 'cobblestone', 'dirt'])
    expect(junkBlocks(bot, ['andesite']).map((b) => b.name)).toEqual(['cobblestone', 'dirt'])
  })
})

describe('climbOut', () => {
  it('pillars to the rim with junk blocks when the target is above', async () => {
    const bot = shaftBot(4, { items: [{ name: 'cobblestone', count: 4 }] })
    scaffoldUp.mockImplementation(async (b, name, targetY) => {
      b.entity.position.y = targetY - 1
      return 'ok'
    })
    const r = await climbOut(bot, { x: 5, y: 71, z: 0 })
    expect(r).toEqual({ status: 'climbed', depth: 4, how: 'pillar' })
    expect(scaffoldUp).toHaveBeenCalledWith(bot, 'cobblestone', 72, expect.anything())
    expect(bot.entity.position.y).toBe(71)
  })

  it('moves on to the next junk block when one runs out', async () => {
    const bot = shaftBot(4, { items: [{ name: 'dirt', count: 2 }, { name: 'cobblestone', count: 1 }] })
    scaffoldUp
      .mockImplementationOnce(async (b) => { b.entity.position.y += 2; return 'no dirt in inventory' })
      .mockImplementationOnce(async (b, name, targetY) => { b.entity.position.y = targetY - 1; return 'ok' })
    const r = await climbOut(bot, { x: 5, y: 71, z: 0 })
    expect(r.status).toBe('climbed')
    expect(scaffoldUp.mock.calls.map((c) => c[1])).toEqual(['dirt', 'cobblestone'])
  })

  it('does nothing when the bot is not in a shaft, or the target is not above it', async () => {
    const open = { entity: { position: new Vec3(0.5, 71, 0.5), onGround: true }, blockAt: makeWorld(), inventory: { items: () => [] } }
    expect((await climbOut(open, { x: 5, y: 75, z: 0 })).status).toBe('not_in_pit')
    const bot = shaftBot(4)
    expect((await climbOut(bot, { x: 3, y: 67, z: 0 })).status).toBe('not_in_pit')
    expect(scaffoldUp).not.toHaveBeenCalled()
  })

  it('says honestly that she is stuck when there are no blocks and no digging', async () => {
    const bot = shaftBot(6)
    const r = await climbOut(bot, { x: 5, y: 71, z: 0 }, { canDig: false })
    expect(r.status).toBe('failed')
    expect(r.line).toMatch(/^stuck in a hole at 0,65,0: could not climb out of the 6-deep shaft/)
    expect(isUnreachableResult(r.line)).toBe(false)
  })

  it('refuses a staircase it would take minutes to dig', async () => {
    const bot = shaftBot(5)
    bot.canDigBlock = () => true
    bot.digTime = () => 7500 // stone by hand
    bot.dig = vi.fn()
    const r = await climbOut(bot, { x: 5, y: 71, z: 0 })
    expect(r.status).toBe('failed')
    expect(r.line).toMatch(/too slow to dig/)
    expect(bot.dig).not.toHaveBeenCalled()
  })

  it('never cuts into a wall next to water or lava', async () => {
    const bot = shaftBot(3)
    const world = bot.blockAt
    // Lava behind every wall the staircase would open.
    bot.blockAt = (p) => (Math.abs(p.x) === 2 || Math.abs(p.z) === 2) && p.y >= 68 && p.y <= 71
      ? { name: 'lava', boundingBox: 'empty' }
      : world(p)
    bot.canDigBlock = () => true
    bot.digTime = () => 400
    bot.dig = vi.fn()
    const r = await climbOut(bot, { x: 5, y: 71, z: 0 })
    expect(r.status).toBe('failed')
    expect(bot.dig).not.toHaveBeenCalled()
  })

  it('returns aborted when the signal fires', async () => {
    const bot = shaftBot(4, { items: [{ name: 'dirt', count: 4 }] })
    const ctl = new AbortController()
    scaffoldUp.mockImplementation(async () => { ctl.abort(); return 'aborted' })
    expect((await climbOut(bot, { x: 5, y: 71, z: 0 }, { signal: ctl.signal })).status).toBe('aborted')
  })
})

describe('unreachable target memory', () => {
  it('covers the noted block, the trunk above it and its neighbours, and expires', () => {
    const bot = {}
    noteUnreachable(bot, { x: 10, y: 77, z: 6 }, 'cant_reach', 1000)
    expect(isUnreachable(bot, { x: 10, y: 77, z: 6 }, 2000)).toBe(true)
    expect(isUnreachable(bot, { x: 10, y: 81, z: 6 }, 2000)).toBe(true) // top of the trunk
    expect(isUnreachable(bot, { x: 11, y: 77, z: 5 }, 2000)).toBe(true) // touching ore
    expect(isUnreachable(bot, { x: 13, y: 77, z: 6 }, 2000)).toBe(false) // another tree
    expect(isUnreachable(bot, { x: 10, y: 71, z: 6 }, 2000)).toBe(false) // the ground below the cliff
    expect(isUnreachable(bot, { x: 10, y: 77, z: 6 }, 1000 + UNREACHABLE_TTL_MS + 1)).toBe(false)
    clearUnreachable(bot)
    expect(isUnreachable(bot, { x: 10, y: 77, z: 6 }, 2000)).toBe(false)
  })

  it('counts only results that blame the target', () => {
    expect(isUnreachableResult('cant_reach (closest=6.5m to target 1,2,3)')).toBe(true)
    expect(isUnreachableResult('timeout — unreachable — try build to Y=77')).toBe(true)
    expect(isUnreachableResult('stuck at 1,2,3, 4.0m from 5,6,7: the path kept failing')).toBe(true)
    expect(isUnreachableResult('out of range (5.7m, need ≤4.5) for oak_log @1,2,3')).toBe(true)
    expect(isUnreachableResult('reached')).toBe(false)
    expect(isUnreachableResult('aborted')).toBe(false)
    expect(isUnreachableResult('stuck in a hole at 0,65,0: could not climb out')).toBe(false)
  })
})
