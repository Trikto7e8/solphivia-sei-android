// 261017 (pass 14): items she tossed to the player with give().
//
// give() tosses at the player's feet, and in the scripted eval the player
// did not always walk over them. The next pickup (or a gather's drop sweep)
// then collected the same logs back, and she told the player their errand
// was done. A toss is remembered here for a few minutes so pickup and the
// sweep leave it alone and the snapshot labels it as given.
//
// Item entities do not always decode their stack on newer protocol
// versions, so an undecoded item near the toss point counts as given too.

import { droppedItemName } from './entities.js'

export const GIVEN_DROP_TTL_MS = 5 * 60_000
/** An item this close to where the player stood (or she stood) at the toss is the toss. */
export const GIVEN_DROP_RADIUS = 4

function plain(p) {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return null
  return { x: p.x, y: p.y, z: p.z }
}

function dist(a, b) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/**
 * @param {object} bot
 * @param {{ item: string, count?: number, at?: {x:number,y:number,z:number}, from?: {x:number,y:number,z:number}, to?: string }} toss
 */
export function recordGivenDrop(bot, toss, now = Date.now()) {
  if (!bot || !toss?.item) return
  const at = plain(toss.at)
  const from = plain(toss.from)
  if (!at && !from) return
  const list = (Array.isArray(bot._seiGivenDrops) ? bot._seiGivenDrops : []).filter((g) => now - g.ts < GIVEN_DROP_TTL_MS)
  list.push({ item: String(toss.item), count: Number(toss.count) || 1, at, from, to: toss.to ?? null, ts: now })
  bot._seiGivenDrops = list.slice(-8)
}

/**
 * The toss an item entity came from, or null when it is not one of hers.
 * @returns {{ item: string, count: number, to: string|null }|null}
 */
export function givenDropFor(bot, entity, now = Date.now()) {
  const list = Array.isArray(bot?._seiGivenDrops) ? bot._seiGivenDrops : null
  if (!list?.length || !entity?.position) return null
  const name = droppedItemName(entity)?.name ?? null
  for (let i = list.length - 1; i >= 0; i--) {
    const g = list[i]
    if (now - g.ts >= GIVEN_DROP_TTL_MS) continue
    if (name && name !== g.item) continue
    const near = (g.at && dist(entity.position, g.at) <= GIVEN_DROP_RADIUS) ||
      (g.from && dist(entity.position, g.from) <= GIVEN_DROP_RADIUS)
    if (near) return g
  }
  return null
}
