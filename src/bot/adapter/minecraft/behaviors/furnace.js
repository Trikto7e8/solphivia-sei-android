// Furnace session: open + load input/fuel + take smelted output (MCRAFT-01, D-09).
//
// Near-exact mirror of container.js: FURNACE_SESSION is module-scoped so the
// orchestrator can call closeFurnaceSession() on chain end / abort to enforce
// the "never overlap" invariant globally (Pitfall: a leaked window breaks the
// next openContainer/openFurnace). The three slot ops follow the
// deposit/withdraw template. mineflayer's Furnace exposes
// .putInput()/.putFuel()/.takeOutput() + .inputItem()/.fuelItem()/.outputItem().
import mcDataLib from 'minecraft-data'
import { resolveBlock, isStaleHandle } from '../observers/targeting.js'
import { reason } from '../../../brain/errStrings.js'

export const OPEN_TIMEOUT_MS = 6000
export const TRANSFER_TIMEOUT_MS = 4000
// 261011: takeSmelted waits this long for the first item when the furnace is
// cooking (one item takes 10s in a furnace, 5s in a blast furnace / smoker).
export const COOK_WAIT_MS = 11000
const COOK_POLL_MS = 250
const REACH = 4

const FURNACE_SESSION = { furnace: null, blockPos: null }

export async function closeFurnaceSession() {
  if (FURNACE_SESSION.furnace) {
    try { await FURNACE_SESSION.furnace.close() } catch {}
    FURNACE_SESSION.furnace = null
    FURNACE_SESSION.blockPos = null
  }
}

function itemIdByName(bot, name) {
  try {
    const data = mcDataLib(bot.version)
    return data?.itemsByName?.[name]?.id ?? null
  } catch {
    return null
  }
}

// 261011: the item on hand for a furnace op. While the furnace window is open
// the player's slots live in the WINDOW (furnace.items() = its inventory
// section), and bot.inventory can lag it: quality eval 2026-10-11 had "crafted
// 4 oak_planks" followed by "no oak_planks to fuel" twice. Check the window
// first, then the inventory.
function findOnHand(bot, furnace, name) {
  try {
    const fromWindow = typeof furnace?.items === 'function' ? furnace.items() : null
    const hit = Array.isArray(fromWindow) ? fromWindow.find((i) => i?.name === name) : null
    if (hit) return hit
  } catch {}
  try { return bot.inventory.items().find((i) => i.name === name) ?? null } catch { return null }
}

function slotText(item) {
  return item ? `${item.count ?? 1} ${item.name}` : 'empty'
}

function isBurning(furnace) {
  return typeof furnace?.fuel === 'number' && furnace.fuel > 0
}

// 261011: one line of furnace state, appended to open/take results so the
// model can see what is loaded instead of guessing (it loaded iron, read
// "nothing smelted yet" one second later, and concluded the iron was gone).
export function furnaceStatus(furnace) {
  let input = null, fuel = null, output = null
  try { input = furnace.inputItem() } catch {}
  try { fuel = furnace.fuelItem() } catch {}
  try { output = furnace.outputItem() } catch {}
  const state = isBurning(furnace) ? (input ? 'cooking' : 'burning, nothing to cook') : (input && !fuel ? 'not cooking: no fuel' : 'not burning')
  return `input ${slotText(input)}, fuel ${slotText(fuel)}, output ${slotText(output)} (${state})`
}

function sleep(ms, signal) {
  return new Promise((r) => {
    const t = setTimeout(r, ms)
    signal?.addEventListener?.('abort', () => { clearTimeout(t); r() }, { once: true })
  })
}

// 261011: the open timeout used to be a bare setTimeout that was never
// cleared, so it closed the window OPEN_TIMEOUT_MS after every SUCCESSFUL
// open, and the next slot call found "no furnace open". The timer and the
// abort listener now apply only until the open settles.
function raceOpen(op, timeoutMs, signal, close) {
  return new Promise((resolve) => {
    let done = false
    const finish = (v) => {
      if (done) return false
      done = true
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
      resolve(v)
      return true
    }
    const timer = setTimeout(async () => {
      if (done) return
      done = true
      signal?.removeEventListener?.('abort', onAbort)
      try { await close() } catch {}
      resolve('timeout')
    }, timeoutMs)
    const onAbort = async () => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { await close() } catch {}
      resolve('aborted')
    }
    signal?.addEventListener?.('abort', onAbort, { once: true })
    op.then((v) => {
      // A window that opens after the timeout or abort already answered is
      // closed again so it cannot leak into the next session.
      if (!finish(v)) close().catch(() => {})
    })
  })
}

function attachAbort(signal, onAbort) {
  return new Promise((r) => {
    if (!signal) return
    signal.addEventListener('abort', async () => {
      try { await onAbort() } catch {}
      r('aborted')
    }, { once: true })
  })
}

export async function openFurnaceAction(args, bot, config) {
  const signal = config?.signal
  if (signal?.aborted) return 'aborted'

  // Never overlap sessions — a leaked window desyncs the next open.
  await closeFurnaceSession()

  const target = await resolveBlock(args, bot)
  if (!target) return isStaleHandle(args) ? 'stale target' : 'no target'

  const dist = bot.entity?.position?.distanceTo?.(target.position)
  if (typeof dist === 'number' && dist > REACH) {
    return `target out of reach (${dist.toFixed(1)}m, need ≤${REACH})`
  }

  const timeoutMs = args.timeout_ms ?? config?.openFurnace_timeout_ms ?? OPEN_TIMEOUT_MS
  const targetName = target.name ?? 'furnace'

  const op = bot.openFurnace(target)
    .then((furnace) => {
      FURNACE_SESSION.furnace = furnace
      FURNACE_SESSION.blockPos = target.position
      let status = ''
      try { status = furnaceStatus(furnace) } catch {}
      return status ? `opened ${targetName}: ${status}` : `opened ${targetName}`
    })
    .catch((err) => {
      const r = reason(err)
      return r ? `cannot open ${targetName}: ${r}` : `cannot open ${targetName}`
    })

  return raceOpen(op, timeoutMs, signal, closeFurnaceSession)
}

export async function smeltInputAction(args, bot, config) {
  const signal = config?.signal
  if (signal?.aborted) return 'aborted'
  if (!FURNACE_SESSION.furnace) return 'no furnace open'

  const { item } = args
  const count = args.count ?? 1
  const furnace = FURNACE_SESSION.furnace
  const invItem = findOnHand(bot, furnace, item)
  if (!invItem) return `no ${item} to smelt`

  const itemId = invItem.type ?? itemIdByName(bot, item)
  if (itemId == null) return `no ${item} to smelt`

  // 261011: the input slot takes one item type. A different item sitting in
  // it made putInput fail with a bare "destination full"; take it back out
  // first (it was not cooking into anything useful for this request).
  let cleared = ''
  let current = null
  try { current = furnace.inputItem() } catch {}
  if (current && current.name !== item && typeof furnace.takeInput === 'function') {
    try {
      await furnace.takeInput()
      cleared = `took ${slotText(current)} back out of the input slot, then `
      current = null
    } catch (err) {
      const r = reason(err)
      return `input slot holds ${slotText(current)} and it could not be taken out${r ? `: ${r}` : ''}`
    }
  }
  const room = current ? Math.max(0, (current.stackSize ?? 64) - (current.count ?? 0)) : Infinity
  if (room === 0) return `input slot is full (${slotText(current)} already cooking)`

  const actualCount = Math.min(count, invItem.count, room)
  const timeoutMs = args.timeout_ms ?? config?.smeltInput_timeout_ms ?? TRANSFER_TIMEOUT_MS

  const op = furnace.putInput(itemId, null, actualCount)
    .then(() => {
      const note = isBurning(furnace) ? '' : (() => { let f = null; try { f = furnace.fuelItem() } catch {} return f ? '' : '; it needs fuel to start' })()
      return `${cleared}smelting ${actualCount} ${item}${note}`
    })
    .catch((err) => {
      const r = reason(err)
      return r ? `smelt ${item} failed: ${r}` : `smelt ${item} failed`
    })

  // Per container discipline: do NOT close session on transfer timeout —
  // chain-end cleanup handles it.
  const tmo = new Promise((r) => setTimeout(() => r('timeout'), timeoutMs))
  const abrt = attachAbort(signal, closeFurnaceSession)

  return Promise.race([op, tmo, abrt])
}

export async function addFuelAction(args, bot, config) {
  const signal = config?.signal
  if (signal?.aborted) return 'aborted'
  if (!FURNACE_SESSION.furnace) return 'no furnace open'

  const { item } = args
  const count = args.count ?? 1
  const furnace = FURNACE_SESSION.furnace
  // 261011: the fuel slot holds one item type. A different fuel already there
  // made putFuel fail with a bare "destination full" (quality eval
  // 2026-10-11: oak_log onto oak_planks, three times). The furnace is fueled
  // already, so say that instead of failing.
  let current = null
  try { current = furnace.fuelItem() } catch {}
  if (current && current.name !== item) {
    return `fuel slot already has ${slotText(current)}, which burns first, so no ${item} was added`
  }
  const invItem = findOnHand(bot, furnace, item)
  if (!invItem) return `no ${item} to fuel`

  const itemId = invItem.type ?? itemIdByName(bot, item)
  if (itemId == null) return `no ${item} to fuel`

  const room = current ? Math.max(0, (current.stackSize ?? 64) - (current.count ?? 0)) : Infinity
  if (room === 0) return `fuel slot is full (${slotText(current)})`
  const actualCount = Math.min(count, invItem.count, room)
  const timeoutMs = args.timeout_ms ?? config?.addFuel_timeout_ms ?? TRANSFER_TIMEOUT_MS

  const op = furnace.putFuel(itemId, null, actualCount)
    .then(() => `added ${actualCount} ${item} fuel`)
    .catch((err) => {
      const r = reason(err)
      return r ? `add ${item} fuel failed: ${r}` : `add ${item} fuel failed`
    })

  const tmo = new Promise((r) => setTimeout(() => r('timeout'), timeoutMs))
  const abrt = attachAbort(signal, closeFurnaceSession)

  return Promise.race([op, tmo, abrt])
}

export async function takeSmeltedAction(args, bot, config) {
  const signal = config?.signal
  if (signal?.aborted) return 'aborted'
  if (!FURNACE_SESSION.furnace) return 'no furnace open'

  const furnace = FURNACE_SESSION.furnace
  // Read the output slot defensively (server-controlled) before taking.
  let out = null
  try { out = furnace.outputItem() } catch {}
  // 261011: wait for the first item while the furnace is actually cooking.
  // The model calls takeSmelted right after loading (the eval saw it 1-2s
  // later, 12 of 16 calls came back "nothing smelted yet"), and a bare
  // "nothing yet" read as "the iron is gone". Cooking = something in the
  // input slot and fuel burning or loaded.
  if (!out) {
    const cookWaitMs = args?.wait_ms ?? config?.takeSmelted_wait_ms ?? COOK_WAIT_MS
    const cooking = () => {
      let input = null, fuel = null
      try { input = furnace.inputItem() } catch {}
      try { fuel = furnace.fuelItem() } catch {}
      return !!input && (isBurning(furnace) || !!fuel)
    }
    const deadline = Date.now() + cookWaitMs
    while (!out && cooking() && Date.now() < deadline) {
      await sleep(COOK_POLL_MS, signal)
      if (signal?.aborted) return 'aborted'
      if (FURNACE_SESSION.furnace !== furnace) return 'furnace closed'
      try { out = furnace.outputItem() } catch {}
    }
  }
  if (!out) {
    let status = ''
    try { status = furnaceStatus(furnace) } catch {}
    return status ? `nothing smelted yet: ${status}` : 'nothing smelted yet'
  }

  const fallbackName = out.name ?? 'item'
  const fallbackCount = out.count ?? 0
  const timeoutMs = args?.timeout_ms ?? config?.takeSmelted_timeout_ms ?? TRANSFER_TIMEOUT_MS

  const op = Promise.resolve()
    .then(() => furnace.takeOutput())
    .then((taken) => {
      const n = taken?.count ?? fallbackCount
      const name = taken?.name ?? fallbackName
      let left = null
      try { left = furnace.inputItem() } catch {}
      return left ? `took ${n} ${name} (${slotText(left)} still cooking)` : `took ${n} ${name}`
    })
    .catch((err) => {
      const r = reason(err)
      return r ? `take output failed: ${r}` : `take output failed`
    })

  const tmo = new Promise((r) => setTimeout(() => r('timeout'), timeoutMs))
  const abrt = attachAbort(signal, closeFurnaceSession)

  return Promise.race([op, tmo, abrt])
}
