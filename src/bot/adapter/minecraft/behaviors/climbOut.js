// src/bot/adapter/minecraft/behaviors/climbOut.js
//
// 261015 quality pass 10: get out of a 1x1 shaft before walking somewhere
// above it.
//
// The companion digs straight down a lot (a dig column under her feet, a
// pathfinder route to buried ore), and the 1x1 shaft that leaves is a trap
// for mineflayer-pathfinder. It plans the tower out at once (28ms), but each
// tower step holds jump and awaits bot.placeBlock, which on this server
// version only settles through its ~5s block-update timeout: every step logs
// `path_reset place_error` and the block shows up right after. So the tower
// climbs one block per ~5s, and a goTo's 12s budget buys two blocks. In the
// 261015 errands eval she rose y57 to y65 over three goTos (~36s), and follow
// trailed underground for 30s. Direct-mode repro on the eval arena, shaft then
// goTo the player 4 blocks away on the surface: 0/2 from a 4-deep shaft (she
// rose 1-2 blocks), 0/2 from 8-deep, with or without blocks to place.
//
// climbOut handles the shaft itself, before the walk:
//   1. pillar up with junk blocks she carries (dirt, cobblestone, ...), using
//      build.js's jump+place scaffold, which climbs about a block a second;
//   2. otherwise cut a staircase into the shaft wall toward the target.
// Then the caller's normal walk takes over from the rim. When neither works it
// returns an honest "could not climb out" line instead of a bare timeout.

import { Vec3 } from 'vec3'
import { scaffoldUp } from './build.js'
import { JUNK_SCAFFOLD } from './pathfind.js'

export { JUNK_SCAFFOLD }


const MAX_PIT_DEPTH = 24
// A rim this close is one jump; the pathfinder handles it.
export const MIN_PIT_DEPTH = 2
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const MAX_STEP_DIG_MS = 2500

function isAirName(name) {
  return name === 'air' || name === 'cave_air' || name === 'void_air'
}

/** The body can stand in this cell (no collision box, not lava). */
export function isPassable(blk) {
  if (!blk) return false
  if (blk.name === 'lava') return false
  return isAirName(blk.name) || blk.boundingBox === 'empty'
}

function isLiquid(blk) {
  return !!blk && (blk.name === 'water' || blk.name === 'lava' || blk.name === 'bubble_column')
}

function isSolid(blk) {
  return !!blk && !isAirName(blk.name) && blk.boundingBox === 'block'
}

const at = (bot, x, y, z) => bot.blockAt(new Vec3(x, y, z))

/**
 * Is the bot at the bottom of a 1x1 shaft, and where is its rim?
 *
 * Enclosed means no side cell at feet level has room to step into (feet and
 * head both passable). Walking up the bot's own column, the rim is the first
 * level with such a side cell. Returns null when the bot is not enclosed (the
 * pathfinder can walk out on its own).
 *
 * @returns {null | { feetY:number, rimY:number|null, depth:number|null, ceilingY?:number, dir?:[number,number] }}
 */
export function pitInfo(bot, maxDepth = MAX_PIT_DEPTH) {
  const p = bot?.entity?.position
  if (!p || typeof bot.blockAt !== 'function') return null
  const x = Math.floor(p.x), z = Math.floor(p.z)
  const feetY = Math.floor(p.y + 0.01)
  const openSide = (y) => {
    for (const [dx, dz] of DIRS) {
      if (isPassable(at(bot, x + dx, y, z + dz)) && isPassable(at(bot, x + dx, y + 1, z + dz))) return [dx, dz]
    }
    return null
  }
  if (openSide(feetY)) return null
  for (let y = feetY + 1; y <= feetY + maxDepth; y++) {
    // The column above must be open for the body to rise through it.
    if (!isPassable(at(bot, x, y + 1, z))) return { feetY, rimY: null, depth: null, ceilingY: y + 1 }
    const dir = openSide(y)
    if (dir) return { feetY, rimY: y, depth: y - feetY, dir }
  }
  return { feetY, rimY: null, depth: null }
}

/** Junk scaffold blocks in the inventory, most plentiful first. */
export function junkBlocks(bot, keepItems = []) {
  const keep = new Set(keepItems)
  const counts = new Map()
  for (const it of bot?.inventory?.items?.() ?? []) {
    if (!JUNK_SCAFFOLD.includes(it.name) || keep.has(it.name)) continue
    counts.set(it.name, (counts.get(it.name) ?? 0) + it.count)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }))
}

async function waitOnGround(bot, maxMs = 1500) {
  const t0 = Date.now()
  while (Date.now() - t0 < maxMs) {
    if (bot.entity?.onGround) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return !!bot.entity?.onGround
}

/** Pillar to `rimY` with whatever junk blocks are on hand. */
async function pillarTo(bot, rimY, signal, keepItems) {
  for (const { name } of junkBlocks(bot, keepItems)) {
    if (Math.floor(bot.entity.position.y + 0.01) >= rimY) return 'ok'
    const r = await scaffoldUp(bot, name, rimY + 1, { signal })
    if (r === 'ok' || r === 'aborted') return r
    if (!String(r).startsWith(`no ${name}`)) return r
  }
  return Math.floor(bot.entity.position.y + 0.01) >= rimY ? 'ok' : 'ran out of blocks'
}

async function digCell(bot, x, y, z, signal) {
  const blk = at(bot, x, y, z)
  if (isPassable(blk)) return 'ok'
  if (!blk || isLiquid(blk)) return 'liquid'
  // Never open a wall onto water or lava.
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]]) {
    if (isLiquid(at(bot, x + dx, y + dy, z + dz))) return 'liquid'
  }
  if (typeof bot.canDigBlock === 'function' && !bot.canDigBlock(blk)) return 'cannot dig'
  try {
    const tool = bot.pathfinder?.bestHarvestTool?.(blk)
    if (tool) await bot.equip(tool, 'hand')
  } catch {}
  // Stone by hand is 7.5s a block and a staircase needs three per step; say
  // so instead of standing there for a minute.
  try {
    if (typeof bot.digTime === 'function' && bot.digTime(blk) > MAX_STEP_DIG_MS) return `${blk.name} is too slow to dig with what you hold`
  } catch {}
  if (signal?.aborted) return 'aborted'
  bot._seiDigActive = (bot._seiDigActive ?? 0) + 1
  const onAbort = () => { try { bot.stopDigging?.() } catch {} }
  signal?.addEventListener?.('abort', onAbort, { once: true })
  try {
    await bot.dig(blk, true)
  } catch (e) {
    return signal?.aborted ? 'aborted' : 'dig failed'
  } finally {
    signal?.removeEventListener?.('abort', onAbort)
    bot._seiDigActive = Math.max(0, (bot._seiDigActive ?? 1) - 1)
  }
  // Sand or gravel may have dropped into the cell.
  return isPassable(at(bot, x, y, z)) ? 'ok' : 'refilled'
}

/** Step onto the block at (x, y-1, z) from the cell beside and below it. */
async function stepUpTo(bot, x, y, z, signal) {
  const target = new Vec3(x + 0.5, y, z + 0.5)
  const t0 = Date.now()
  try {
    await bot.lookAt(target.offset(0, 1.2, 0), true)
  } catch {}
  bot.setControlState('forward', true)
  bot.setControlState('jump', true)
  try {
    while (Date.now() - t0 < 2000) {
      if (signal?.aborted) return false
      const p = bot.entity.position
      if (Math.floor(p.y + 0.01) >= y && Math.abs(p.x - target.x) < 0.4 && Math.abs(p.z - target.z) < 0.4) break
      if (Math.floor(p.y + 0.01) >= y) bot.setControlState('jump', false)
      try { await bot.lookAt(target.offset(0, 1.2, 0), true) } catch {}
      await new Promise((r) => setTimeout(r, 50))
    }
  } finally {
    bot.setControlState('forward', false)
    bot.setControlState('jump', false)
  }
  await waitOnGround(bot, 800)
  const p = bot.entity.position
  return Math.floor(p.y + 0.01) >= y && Math.floor(p.x) === x && Math.floor(p.z) === z
}

/**
 * Cut a straight staircase out of the shaft, rising one block per step. Each
 * step clears the head room above the current cell and the two cells of the
 * next one, then jumps onto it. Tries the direction toward the target first.
 */
async function stairTo(bot, rimY, toward, signal, deadline) {
  const p0 = bot.entity.position
  const order = [...DIRS].sort((a, b) => {
    const da = toward ? -(a[0] * (toward.x - p0.x) + a[1] * (toward.z - p0.z)) : 0
    const db = toward ? -(b[0] * (toward.x - p0.x) + b[1] * (toward.z - p0.z)) : 0
    return da - db
  })
  let lastWhy = 'no direction to dig'
  for (const [dx, dz] of order) {
    let ok = true
    while (Math.floor(bot.entity.position.y + 0.01) < rimY) {
      if (signal?.aborted) return 'aborted'
      if (Date.now() > deadline) return 'out of time'
      const p = bot.entity.position
      const x = Math.floor(p.x), y = Math.floor(p.y + 0.01), z = Math.floor(p.z)
      const nx = x + dx, nz = z + dz
      const step = at(bot, nx, y, nz)
      if (!isSolid(step)) { lastWhy = 'no wall to step on'; ok = false; break }
      // Head room to jump from here, then the two cells of the next step.
      for (const [cx, cy, cz] of [[x, y + 2, z], [nx, y + 1, nz], [nx, y + 2, nz]]) {
        let r = await digCell(bot, cx, cy, cz, signal)
        if (r === 'refilled') r = await digCell(bot, cx, cy, cz, signal)
        if (r !== 'ok') { lastWhy = r; ok = false; break }
      }
      if (!ok) break
      if (!(await stepUpTo(bot, nx, y + 1, nz, signal))) {
        if (signal?.aborted) return 'aborted'
        lastWhy = 'could not step up'
        ok = false
        break
      }
    }
    if (Math.floor(bot.entity.position.y + 0.01) >= rimY) return 'ok'
    // A failed first step leaves the bot where it was; try the next wall.
    // A failure higher up keeps going from the new cell in the next direction.
  }
  return lastWhy
}

/**
 * Climb out of the 1x1 shaft the bot is standing in, if it is in one and the
 * destination is above it.
 *
 * @param {object} bot
 * @param {{x:number,y:number,z:number}|null} target where the caller is headed
 * @param {{ signal?: AbortSignal, budgetMs?: number, keepItems?: string[], canDig?: boolean }} [opts]
 * @returns {Promise<{ status: 'not_in_pit'|'climbed'|'aborted'|'failed', depth?: number, how?: 'pillar'|'stairs', line?: string }>}
 *   `line` (on 'failed') is an honest result line that starts with
 *   "stuck in a hole", so callers can return it as is.
 */
export async function climbOut(bot, target, opts = {}) {
  const { signal, budgetMs = 20000, keepItems = [], canDig = true } = opts
  if (!bot?.entity?.position) return { status: 'not_in_pit' }
  if (signal?.aborted) return { status: 'aborted' }
  await waitOnGround(bot, 1000)
  const pit = pitInfo(bot)
  // No open rim (roofed over, or deeper than we look) is left to the
  // pathfinder's own digging, like a pit that is not a pit.
  if (!pit || pit.rimY == null || pit.depth < MIN_PIT_DEPTH) return { status: 'not_in_pit' }
  const ty = Number(target?.y)
  if (Number.isFinite(ty) && ty < pit.feetY + MIN_PIT_DEPTH) return { status: 'not_in_pit' }
  const here = `${Math.floor(bot.entity.position.x)},${pit.feetY},${Math.floor(bot.entity.position.z)}`

  const deadline = Date.now() + budgetMs
  let why = ''
  if (junkBlocks(bot, keepItems).length) {
    const r = await pillarTo(bot, pit.rimY, signal, keepItems)
    if (r === 'aborted') return { status: 'aborted' }
    if (r === 'ok') return { status: 'climbed', depth: pit.depth, how: 'pillar' }
    why = `pillar: ${r}`
  }
  if (canDig && Math.floor(bot.entity.position.y + 0.01) < pit.rimY) {
    await waitOnGround(bot, 1000)
    const r = await stairTo(bot, pit.rimY, target, signal, deadline)
    if (r === 'aborted') return { status: 'aborted' }
    if (r === 'ok') return { status: 'climbed', depth: pit.depth, how: 'stairs' }
    why = why ? `${why}; staircase: ${r}` : `staircase: ${r}`
  }
  if (Math.floor(bot.entity.position.y + 0.01) >= pit.rimY) return { status: 'climbed', depth: pit.depth, how: 'stairs' }
  const now = Math.floor(bot.entity.position.y + 0.01)
  const blocks = junkBlocks(bot, keepItems).reduce((n, b) => n + b.count, 0)
  return {
    status: 'failed',
    depth: pit.depth,
    line: `stuck in a hole at ${here}: could not climb out of the ${pit.depth}-deep shaft (now y=${now}, rim y=${pit.rimY}, ` +
      `${blocks} scaffold blocks left; ${why || 'no blocks to pillar with and digging is off'}). ` +
      'Get dirt or cobblestone to pillar up with, or dig a staircase up the wall',
  }
}
