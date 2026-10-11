// src/bot/adapter/minecraft/behaviors/pickup.js — `pickup` action.
//
// 261011: there was no way to pick up dropped items on purpose. In the
// combat_night quality run she died, her stone sword and food lay a few
// blocks away, and she spent five goTo calls standing on the spot she was
// already on ("goTo -> reached") without collecting anything, then fought
// the rest of the night bare-handed. pickup walks onto each dropped item near
// her, closest first, so mineflayer's auto-collect takes it, and reports what
// actually reached the inventory.

import { goTo as realGoTo, dropWalkOpts } from './pathfind.js'
import { droppedItemName } from '../observers/entities.js'

const MAX_ITEMS = 10
const WALK_MS = 4000
const SETTLE_MS = 300
const ABOVE_LIMIT = 3

function isItemEntity(e) {
  return !!e && (e.name === 'item' || e.name === 'item_stack' || e.displayName === 'Item')
}

/** Item name -> count over the whole inventory; null when the bot has no inventory API. */
export function inventoryCounts(bot) {
  if (typeof bot?.inventory?.items !== 'function') return null
  const out = new Map()
  let items = []
  try { items = bot?.inventory?.items?.() ?? [] } catch { items = [] }
  for (const it of items) {
    if (!it?.name) continue
    out.set(it.name, (out.get(it.name) ?? 0) + (it.count ?? 1))
  }
  return out
}

/** "N name" for every item that went up between two inventoryCounts maps. */
export function gained(before, after) {
  const parts = []
  if (!before || !after) return parts
  for (const [name, n] of after) {
    const d = n - (before.get(name) ?? 0)
    if (d > 0) parts.push(`${d} ${name}`)
  }
  return parts
}

/**
 * @param {{ item?: string, maxDistance?: number }} args
 * @param {import('mineflayer').Bot} bot
 * @param {{ signal?: AbortSignal }} [config]
 * @param {{ goTo?: typeof realGoTo, sleep?: (ms:number)=>Promise<void> }} [_deps]
 */
export async function pickupAction(args, bot, config, _deps) {
  const goTo = _deps?.goTo ?? realGoTo
  const sleep = _deps?.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  const signal = config?.signal
  if (signal?.aborted) return 'aborted'

  const maxDistance = Number.isFinite(args?.maxDistance) ? args.maxDistance : 16
  const want = typeof args?.item === 'string' && args.item.trim() ? args.item.trim().toLowerCase() : null
  const before = inventoryCounts(bot)
  const attempted = new Set()
  let seen = 0

  for (let i = 0; i < MAX_ITEMS; i++) {
    if (signal?.aborted) break
    const here = bot.entity?.position
    if (!here) break
    let best = null
    let bestD = Infinity
    for (const e of Object.values(bot.entities ?? {})) {
      if (!isItemEntity(e) || !e.position || e.isValid === false) continue
      if (attempted.has(e.id)) continue
      if (e.position.y > here.y + ABOVE_LIMIT) continue
      if (want) {
        const it = droppedItemName(e)
        if (!it || it.name !== want) continue
      }
      const d = e.position.distanceTo(here)
      if (d <= maxDistance && d < bestD) { bestD = d; best = e }
    }
    if (!best) break
    seen++
    attempted.add(best.id)
    // Digging is allowed unless the drop is wood (dropWalkOpts): a mined
    // block's drop usually sits in the hole it left. goTo cancels a dig the
    // pathfinder leaves running when the walk ends.
    const it = droppedItemName(best)
    await goTo(bot, Math.floor(best.position.x), Math.floor(best.position.y), Math.floor(best.position.z), 0, WALK_MS, signal, dropWalkOpts(it?.name))
    if (signal?.aborted) break
    await sleep(SETTLE_MS)
  }

  const got = gained(before, inventoryCounts(bot))
  const what = want ?? 'dropped items'
  if (got.length) {
    const prefix = signal?.aborted ? 'aborted after picking up' : 'picked up'
    return `${prefix} ${got.join(', ')}`
  }
  if (signal?.aborted) return 'aborted'
  if (seen === 0) return `no ${what} within ${maxDistance}m`
  return `could not pick up the ${what} (walked to ${seen}, nothing reached your inventory; they may be out of reach or your inventory is full)`
}
