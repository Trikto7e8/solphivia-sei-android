// 261025 quality pass 27: the model-facing dig walks into reach first and
// says what reached the inventory.
import { describe, it, expect, vi } from 'vitest'
import { Vec3 } from 'vec3'
import { createRequire } from 'module'
import { digToolAction } from './digTool.js'

const require = createRequire(import.meta.url)
const ids = Object.fromEntries(Object.values(require('minecraft-data')('1.21.1').blocks).map((b) => [b.id, b.name]))

function makeBot({ at = new Vec3(0.5, 65, 0.5), blocks = {}, inv = {} } = {}) {
  const items = { ...inv }
  const bot = {
    version: '1.21.1',
    entity: { position: at, onGround: true },
    entities: {},
    blockAt(p) {
      const name = blocks[`${p.x},${p.y},${p.z}`] ?? (p.y <= 64 ? 'stone' : 'air')
      return { name, position: new Vec3(p.x, p.y, p.z) }
    },
    inventory: {
      items: () => Object.entries(items).filter(([, c]) => c > 0).map(([name, count]) => ({ name, count })),
    },
    _give(name, n) { items[name] = (items[name] ?? 0) + n },
    findBlocks({ matching, count }) {
      const want = new Set((Array.isArray(matching) ? matching : []).map((id) => ids[id]))
      return Object.entries(blocks)
        .filter(([, n]) => want.has(n))
        .map(([k]) => new Vec3(...k.split(',').map(Number)))
        .sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position))
        .slice(0, count ?? 1)
    },
  }
  return bot
}

const noSleep = async () => {}

describe('digToolAction (261025)', () => {
  it('reports the drop that reached the inventory', async () => {
    const bot = makeBot({ blocks: { '2,65,0': 'stone' }, inv: { cobblestone: 4 } })
    const digAction = vi.fn(async () => { bot._give('cobblestone', 1); return 'dug stone' })
    const goTo = vi.fn(async () => 'reached')
    const r = await digToolAction({ x: 2, y: 65, z: 0 }, bot, {}, { goTo, digAction, sleep: noSleep })
    expect(goTo).not.toHaveBeenCalled()
    expect(r).toBe('dug stone; 1 cobblestone reached your inventory (you have 5 now)')
  })

  it('says where the drop still lies when it did not reach the inventory', async () => {
    const bot = makeBot({ blocks: { '2,65,0': 'stone' } })
    bot.entities[7] = { id: 7, name: 'item', position: new Vec3(2.5, 64, 0.5), metadata: [] }
    const digAction = vi.fn(async () => 'dug stone (pickup walk did not reach)')
    const goTo = vi.fn(async () => 'timeout')
    const r = await digToolAction({ x: 2, y: 65, z: 0 }, bot, {}, { goTo, digAction, sleep: noSleep })
    // One short walk onto the drop.
    expect(goTo).toHaveBeenCalledTimes(1)
    expect(goTo.mock.calls[0].slice(1, 4)).toEqual([2, 64, 0])
    expect(r).toBe('dug stone, but the cobblestone it dropped is still on the ground at 2,64,0, not in your inventory (pickup collects it)')
  })

  it('a drop picked up on the short walk counts', async () => {
    const bot = makeBot({ blocks: { '2,65,0': 'stone' } })
    bot.entities[7] = { id: 7, name: 'item', position: new Vec3(2.5, 64, 0.5), metadata: [] }
    const digAction = vi.fn(async () => 'dug stone')
    const goTo = vi.fn(async () => { delete bot.entities[7]; bot._give('cobblestone', 1); return 'reached' })
    const r = await digToolAction({ x: 2, y: 65, z: 0 }, bot, {}, { goTo, digAction, sleep: noSleep })
    expect(r).toBe('dug stone; 1 cobblestone reached your inventory (you have 1 now)')
  })

  it('leaves the no-drop note alone', async () => {
    const bot = makeBot({ blocks: { '2,65,0': 'stone' } })
    const msg = 'dug stone (no drop, you have no tool that can harvest stone; craft the right pickaxe first)'
    const digAction = vi.fn(async () => msg)
    const r = await digToolAction({ x: 2, y: 65, z: 0 }, bot, {}, { goTo: vi.fn(), digAction, sleep: noSleep })
    expect(r).toBe(msg)
  })

  it('walks into reach measured from the eyes, keeping what it came to dig', async () => {
    const bot = makeBot({ blocks: { '9,65,0': 'oak_log' } })
    const goTo = vi.fn(async () => { bot.entity.position = new Vec3(6.5, 65, 0.5); return 'reached' })
    const digAction = vi.fn(async () => { bot._give('oak_log', 1); return 'dug oak_log' })
    const r = await digToolAction({ block: 'oak_log' }, bot, { pathfinder_timeout_ms: 5000 }, { goTo, digAction, sleep: noSleep })
    expect(goTo).toHaveBeenCalledWith(bot, 9, 65, 0, 3, 5000, undefined, { reach: 4.2, keepItems: ['oak_log'] })
    expect(digAction).toHaveBeenCalledWith({ x: 9, y: 65, z: 0 }, bot, expect.anything())
    expect(r).toMatch(/^dug oak_log; 1 oak_log reached your inventory/)
  })

  it('names what is missing when nothing of that kind is near', async () => {
    const bot = makeBot()
    const r = await digToolAction({ block: 'diamond_ore', maxDistance: 32 }, bot, {}, { goTo: vi.fn(), digAction: vi.fn(), sleep: noSleep })
    expect(r).toBe('no diamond_ore within 32m')
  })

  it('passes a cuboid straight through, and stops on abort', async () => {
    const bot = makeBot()
    const digAction = vi.fn(async () => 'dug 4/4 cells')
    const args = { x: 0, y: 64, z: 0, to: { x: 1, y: 64, z: 1 } }
    expect(await digToolAction(args, bot, {}, { goTo: vi.fn(), digAction, sleep: noSleep })).toBe('dug 4/4 cells')
    expect(digAction).toHaveBeenCalledWith(args, bot, {})

    const ac = new AbortController()
    const goTo = vi.fn(async () => { ac.abort(); return 'aborted' })
    const bot2 = makeBot({ blocks: { '20,65,0': 'stone' } })
    const dig2 = vi.fn()
    expect(await digToolAction({ x: 20, y: 65, z: 0 }, bot2, { signal: ac.signal }, { goTo, digAction: dig2, sleep: noSleep })).toBe('aborted')
    expect(dig2).not.toHaveBeenCalled()
  })
})
