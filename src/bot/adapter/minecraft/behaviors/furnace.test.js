// Furnace 3-slot smelting (MCRAFT-01) — open + load input/fuel + take output.
// Mirrors the container/craft test mock style. Session is module-scoped, so a
// beforeEach closeFurnaceSession() resets the single-flight state between cases.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRequire } from 'module'
import {
  openFurnaceAction,
  smeltInputAction,
  addFuelAction,
  takeSmeltedAction,
  closeFurnaceSession,
} from './furnace.js'

const require = createRequire(import.meta.url)
const VERSION = '1.21.1'
const mcData = require('minecraft-data')(VERSION)
const id = (name) => mcData.itemsByName[name].id

function makeFurnace({ output = null, input = null, fuel = null, windowItems = null } = {}) {
  const f = {
    slots: { input, fuel, output },
    putInput: vi.fn(async () => {}),
    putFuel: vi.fn(async () => {}),
    takeOutput: vi.fn(async () => f.slots.output),
    takeInput: vi.fn(async () => { const it = f.slots.input; f.slots.input = null; return it }),
    inputItem: () => f.slots.input,
    fuelItem: () => f.slots.fuel,
    outputItem: () => f.slots.output,
    close: vi.fn(async () => {}),
  }
  if (windowItems) f.items = () => windowItems
  return f
}

const FURNACE_BLOCK = { name: 'furnace', position: { x: 10, y: 64, z: 10 } }

function makeBot({ items = [], block = FURNACE_BLOCK, furnace = makeFurnace() } = {}) {
  const stacks = items.map((it) => ({ name: it.name, type: id(it.name), count: it.count }))
  return {
    version: VERSION,
    entity: { position: { x: 10, y: 64, z: 11, distanceTo: () => 1 } },
    inventory: { items: () => stacks },
    blockAt: () => block,
    findBlock: () => block,
    openFurnace: vi.fn(async () => furnace),
  }
}

beforeEach(async () => {
  await closeFurnaceSession()
})

describe('openFurnaceAction', () => {
  it('returns "no target" when no furnace block resolves', async () => {
    const bot = makeBot({ block: null })
    const res = await openFurnaceAction({ block: 'furnace' }, bot, {})
    expect(res).toBe('no target')
  })

  it('returns "out of reach" style string when the furnace is too far', async () => {
    const bot = makeBot()
    bot.entity.position.distanceTo = () => 9
    const res = await openFurnaceAction({ block: 'furnace' }, bot, {})
    expect(res).toMatch(/out of reach/i)
  })

  it('opens a reachable furnace and stores the session', async () => {
    const furnace = makeFurnace()
    const bot = makeBot({ furnace })
    const res = await openFurnaceAction({ block: 'furnace' }, bot, {})
    expect(res).toBe('opened furnace: input empty, fuel empty, output empty (not burning)')
    expect(bot.openFurnace).toHaveBeenCalledTimes(1)
  })

  it('returns "aborted" when the signal is already aborted', async () => {
    const c = new AbortController()
    c.abort()
    const bot = makeBot()
    expect(await openFurnaceAction({ block: 'furnace' }, bot, { signal: c.signal })).toBe('aborted')
  })

  it('keeps a successfully opened window open past the open timeout', async () => {
    vi.useFakeTimers()
    try {
      const furnace = makeFurnace()
      const c = new AbortController()
      await openFurnaceAction({ block: 'furnace' }, makeBot({ furnace }), { signal: c.signal })
      await vi.advanceTimersByTimeAsync(60_000)
      // The action's own signal aborting later must not close it either.
      c.abort()
      await vi.advanceTimersByTimeAsync(0)
      expect(furnace.close).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes a window that opens only after the timeout answered', async () => {
    vi.useFakeTimers()
    try {
      const furnace = makeFurnace()
      const bot = makeBot({ furnace })
      let release
      bot.openFurnace = vi.fn(() => new Promise((r) => { release = () => r(furnace) }))
      const p = openFurnaceAction({ block: 'furnace', timeout_ms: 1000 }, bot, {})
      await vi.advanceTimersByTimeAsync(1000)
      expect(await p).toBe('timeout')
      release()
      await vi.advanceTimersByTimeAsync(0)
      expect(furnace.close).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('smeltInputAction', () => {
  it('returns "no furnace open" when no session is active', async () => {
    const bot = makeBot({ items: [{ name: 'raw_iron', count: 4 }] })
    const res = await smeltInputAction({ item: 'raw_iron', count: 1 }, bot, {})
    expect(res).toBe('no furnace open')
  })

  it('returns "no <item> to smelt" when the item is not in inventory', async () => {
    const furnace = makeFurnace()
    await openFurnaceAction({ block: 'furnace' }, makeBot({ furnace }), {})
    const bot = makeBot({ items: [], furnace })
    const res = await smeltInputAction({ item: 'raw_iron', count: 1 }, bot, {})
    expect(res).toBe('no raw_iron to smelt')
  })

  it('loads input and reports the count smelting', async () => {
    const furnace = makeFurnace()
    await openFurnaceAction({ block: 'furnace' }, makeBot({ furnace }), {})
    const bot = makeBot({ items: [{ name: 'raw_iron', count: 4 }], furnace })
    const res = await smeltInputAction({ item: 'raw_iron', count: 2 }, bot, {})
    expect(res).toBe('smelting 2 raw_iron; it needs fuel to start')
    expect(furnace.putInput).toHaveBeenCalledTimes(1)
    expect(furnace.putInput.mock.calls[0][0]).toBe(id('raw_iron'))
  })

  // 261011: quality eval 2026-10-11 — iron_ingot sitting in the input slot made
  // every later smeltInput(raw_iron) fail with a bare "destination full".
  it('takes a different item out of the input slot before loading', async () => {
    const furnace = makeFurnace({ input: { name: 'iron_ingot', count: 2 }, fuel: { name: 'coal', count: 1 } })
    await openFurnaceAction({ block: 'furnace' }, makeBot({ furnace }), {})
    const bot = makeBot({ items: [{ name: 'raw_iron', count: 3 }], furnace })
    const res = await smeltInputAction({ item: 'raw_iron', count: 3 }, bot, {})
    expect(furnace.takeInput).toHaveBeenCalledTimes(1)
    expect(res).toBe('took 2 iron_ingot back out of the input slot, then smelting 3 raw_iron')
  })

  // 261011: "crafted 4 oak_planks" then "no oak_planks to fuel" — the open
  // window holds the player's slots and bot.inventory lagged it.
  it('finds the item in the open furnace window when bot.inventory lags', async () => {
    const furnace = makeFurnace({ fuel: { name: 'coal', count: 1 }, windowItems: [{ name: 'raw_iron', type: id('raw_iron'), count: 2 }] })
    await openFurnaceAction({ block: 'furnace' }, makeBot({ furnace }), {})
    const bot = makeBot({ items: [], furnace })
    const res = await smeltInputAction({ item: 'raw_iron', count: 1 }, bot, {})
    expect(res).toBe('smelting 1 raw_iron')
  })
})

describe('addFuelAction', () => {
  it('loads fuel and reports it', async () => {
    const furnace = makeFurnace()
    await openFurnaceAction({ block: 'furnace' }, makeBot({ furnace }), {})
    const bot = makeBot({ items: [{ name: 'coal', count: 8 }], furnace })
    const res = await addFuelAction({ item: 'coal', count: 1 }, bot, {})
    expect(res).toBe('added 1 coal fuel')
    expect(furnace.putFuel).toHaveBeenCalledTimes(1)
  })

  // 261011: oak_log onto a fuel slot holding oak_planks failed as "destination
  // full" three times in one session; the furnace was already fueled.
  it('reports the fuel already in the slot instead of failing on a different fuel', async () => {
    const furnace = makeFurnace({ fuel: { name: 'oak_planks', count: 3 } })
    await openFurnaceAction({ block: 'furnace' }, makeBot({ furnace }), {})
    const bot = makeBot({ items: [{ name: 'oak_log', count: 4 }], furnace })
    const res = await addFuelAction({ item: 'oak_log', count: 1 }, bot, {})
    expect(res).toBe('fuel slot already has 3 oak_planks, which burns first, so no oak_log was added')
    expect(furnace.putFuel).not.toHaveBeenCalled()
  })

  it('returns "no <item> to fuel" when the fuel item is absent', async () => {
    const furnace = makeFurnace()
    await openFurnaceAction({ block: 'furnace' }, makeBot({ furnace }), {})
    const bot = makeBot({ items: [], furnace })
    const res = await addFuelAction({ item: 'coal', count: 1 }, bot, {})
    expect(res).toBe('no coal to fuel')
  })
})

describe('takeSmeltedAction', () => {
  it('returns "nothing smelted yet" when the output slot is empty', async () => {
    const furnace = makeFurnace({ output: null })
    await openFurnaceAction({ block: 'furnace' }, makeBot({ furnace }), {})
    const res = await takeSmeltedAction({}, makeBot({ furnace }), {})
    expect(res).toBe('nothing smelted yet: input empty, fuel empty, output empty (not burning)')
  })

  // 261011: takeSmelted called 1-2s after loading came back "nothing smelted
  // yet" 12 of 16 times. While it is cooking, wait for the first item.
  it('waits for the first item while the furnace is cooking', async () => {
    vi.useFakeTimers()
    try {
      const furnace = makeFurnace({ input: { name: 'raw_iron', count: 3 }, fuel: { name: 'coal', count: 1 } })
      furnace.fuel = 0.9
      await openFurnaceAction({ block: 'furnace' }, makeBot({ furnace }), {})
      const p = takeSmeltedAction({}, makeBot({ furnace }), {})
      await vi.advanceTimersByTimeAsync(4000)
      furnace.slots.output = { name: 'iron_ingot', count: 1 }
      furnace.slots.input = { name: 'raw_iron', count: 2 }
      await vi.advanceTimersByTimeAsync(500)
      expect(await p).toBe('took 1 iron_ingot (2 raw_iron still cooking)')
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives up after the wait and reports the furnace state', async () => {
    vi.useFakeTimers()
    try {
      const furnace = makeFurnace({ input: { name: 'raw_iron', count: 1 }, fuel: { name: 'coal', count: 1 } })
      await openFurnaceAction({ block: 'furnace' }, makeBot({ furnace }), {})
      const p = takeSmeltedAction({}, makeBot({ furnace }), {})
      await vi.advanceTimersByTimeAsync(12_000)
      expect(await p).toBe('nothing smelted yet: input 1 raw_iron, fuel 1 coal, output empty (not burning)')
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns "took N <item>" when the output is ready', async () => {
    const furnace = makeFurnace({ output: { name: 'iron_ingot', count: 3, type: id('iron_ingot') } })
    await openFurnaceAction({ block: 'furnace' }, makeBot({ furnace }), {})
    const res = await takeSmeltedAction({}, makeBot({ furnace }), {})
    expect(res).toBe('took 3 iron_ingot')
    expect(furnace.takeOutput).toHaveBeenCalledTimes(1)
  })

  it('returns "no furnace open" when no session is active', async () => {
    const res = await takeSmeltedAction({}, makeBot(), {})
    expect(res).toBe('no furnace open')
  })
})

describe('closeFurnaceSession', () => {
  it('closes the open furnace and clears the session', async () => {
    const furnace = makeFurnace()
    await openFurnaceAction({ block: 'furnace' }, makeBot({ furnace }), {})
    await closeFurnaceSession()
    expect(furnace.close).toHaveBeenCalledTimes(1)
    // After close, slot ops report no open furnace.
    expect(await takeSmeltedAction({}, makeBot(), {})).toBe('no furnace open')
  })
})
