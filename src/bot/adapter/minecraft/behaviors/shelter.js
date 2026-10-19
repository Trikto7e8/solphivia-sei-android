// src/behaviors/shelter.js — thin shelter convenience (MCRAFT-06, D-09).
//
// NOT a new world primitive: a shelter is a COMPOSITION of the existing
// build()/dig() cuboid actions — four hollow walls + a solid roof layer, with a
// one-block-wide, two-tall doorway carved out of the front wall. Keeping it a
// composition preserves the closed-registry invariant (no new place/dig path)
// and the 256-cell guarantee (ShelterSchema caps size to 5 → ≤48 wall + 25 roof
// cells, well under the cap that buildAction's own schema enforces).
import { Vec3 } from 'vec3'
import { buildAction, enumerateBuildCells, isOccupied } from './build.js'
import { digAction } from './dig.js'

const WALL_HEIGHT = 3 // wall layers (y range height); roof sits one above.

// 261012: cheap full blocks the shelter may switch to when the asked material
// runs short (the quality eval gave her 64 planks + 64 cobblestone, and a 5x5
// needs 73: the walls went up in planks and the roof was refused).
const FILLER = /^(cobblestone|cobbled_deepslate|stone|dirt|coarse_dirt|netherrack|blackstone|andesite|diorite|granite|tuff|deepslate|sandstone|red_sandstone|bricks|stone_bricks|mud_bricks|[a-z_]+_planks)$/

function invCount(bot, name) {
  try { return bot.inventory.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0) } catch { return 0 }
}

function solidAt(bot, x, y, z) {
  const b = bot.blockAt?.(new Vec3(x, y, z))
  if (!b) return null // unloaded: unknown
  return b.boundingBox === 'block' && !/^(air|cave_air|void_air)$/.test(b.name)
}

/**
 * 261012. The layer the walls start on: the first air layer on top of solid
 * ground at the center column, searched a few blocks either way from `y0`.
 * The old base was floor(bot.y) + 1, one layer ABOVE the ground the bot
 * stands on, so every wall cell floated with nothing under or beside it and
 * all 48 cells of a 5x5 failed (quality eval build_shelter: 0 placed in every
 * direct trial). A `center` the model passes may be its feet (pos: y) or the
 * ground block under them; both land on the same layer here.
 */
export function shelterBaseY(bot, cx, y0, cz) {
  let y = y0
  for (let i = 0; i < 3 && solidAt(bot, cx, y, cz) === true; i++) y++
  for (let i = 0; i < 4 && solidAt(bot, cx, y - 1, cz) === false; i++) y--
  return y
}

/** Air cells a span still needs. */
function cellsNeeded(bot, from, to, hollow) {
  return enumerateBuildCells(from, to, hollow).reduce((n, c) => n + (isOccupied(bot, c) ? 0 : 1), 0)
}

/**
 * The block to build one part with: `material` when there is enough of it,
 * else the filler block with the most on hand that covers the part. Falls
 * back to `material` so buildAction reports the shortfall with both numbers.
 */
function pickBlock(bot, material, needed) {
  if (invCount(bot, material) >= needed) return material
  let best = null, bestN = 0
  let items = []
  try { items = bot.inventory.items() } catch {}
  for (const it of items) {
    if (it.name === material || !FILLER.test(it.name)) continue
    const n = invCount(bot, it.name)
    if (n >= needed && n > bestN) { best = it.name; bestN = n }
  }
  return best ?? material
}

export async function shelterAction(args, bot, config) {
  const signal = config?.signal
  if (signal?.aborted) return 'aborted'

  const size = args?.size ?? 3
  const material = args?.material ?? 'cobblestone'

  // Default center = the bot's current position.
  const p = bot.entity?.position ?? { x: 0, y: 64, z: 0 }
  const cx = args?.center ? Math.round(args.center.x) : Math.floor(p.x)
  const cz = args?.center ? Math.round(args.center.z) : Math.floor(p.z)
  const y0 = args?.center ? Math.floor(args.center.y) : Math.floor(p.y)
  const baseY = shelterBaseY(bot, cx, y0, cz)

  const half = Math.floor((size - 1) / 2)
  const minX = cx - half
  const maxX = minX + size - 1
  const minZ = cz - half
  const maxZ = minZ + size - 1
  const topY = baseY + WALL_HEIGHT - 1 // highest wall layer
  const roofY = topY + 1

  const wallFrom = { x: minX, y: baseY, z: minZ }, wallTo = { x: maxX, y: topY, z: maxZ }
  const roofFrom = { x: minX, y: roofY, z: minZ }, roofTo = { x: maxX, y: roofY, z: maxZ }
  const notes = []

  // 1. Four hollow walls across the full height range.
  const wallNeed = cellsNeeded(bot, wallFrom, wallTo, true)
  const wallBlock = pickBlock(bot, material, wallNeed)
  // 261019 (quality pass 19): too few blocks of any one kind for the walls.
  // The build's own refusal ended with "or build a smaller span", which a 3x3
  // shelter (the smallest) cannot do, and did not count the roof, so she
  // retried the same shelter with 18 of 20 dirt. Say the exact shortfall for
  // the whole shelter, before any walking.
  const haveWall = invCount(bot, wallBlock)
  if (haveWall < wallNeed) {
    const roofNeed = cellsNeeded(bot, roofFrom, roofTo, false)
    const short = wallNeed - haveWall
    const smaller = size > 3
      ? `, or ask for a smaller shelter (size ${size - 1} or 3)`
      : ' (3x3 is the smallest shelter, so it will not fit in fewer blocks)'
    const roof = roofNeed > 0 ? ` After the walls, the roof needs ${roofNeed} more of any full block.` : ''
    return `no shelter built: the walls need ${wallNeed} blocks of one kind and you have ${haveWall} ${wallBlock}, ${short} short.${roof} Gather at least ${short} more ${wallBlock} (or ask the player for some) before trying again${smaller}.`
  }
  if (wallBlock !== material) notes.push(`walls in ${wallBlock}, not enough ${material}`)
  const wallsRes = await buildAction({ from: wallFrom, to: wallTo, block: wallBlock, hollow: true }, bot, config)
  if (isAborted(wallsRes)) return abortedAt('walls', wallsRes)
  // 261011: a shelter with no walls is not a shelter. The result used to read
  // "built shelter 3x3x3 with a doorway (walls: no cobblestone in inventory...)"
  // and the model told the player they were safe inside.
  if (!placedSome(wallsRes)) return `no shelter built: walls: ${wallsRes}`

  // 2. Solid roof: a single-Y cuboid capping the top.
  const roofBlock = pickBlock(bot, material, cellsNeeded(bot, roofFrom, roofTo, false))
  if (roofBlock !== material) notes.push(`roof in ${roofBlock}, not enough ${material}`)
  const roofRes = await buildAction({ from: roofFrom, to: roofTo, block: roofBlock, hollow: false }, bot, config)
  if (isAborted(roofRes)) return abortedAt('roof', roofRes, wallsRes)

  // 3. Carve a one-block-wide, two-tall doorway out of the front (min-Z) wall,
  //    centered on the footprint, so the bot can walk in and out.
  const doorX = cx
  const doorRes = await digAction(
    { x: doorX, y: baseY, z: minZ, to: { x: doorX, y: baseY + 1, z: minZ } },
    bot,
    config,
  )
  if (doorRes === 'aborted') return 'aborted'

  const done = buildComplete(wallsRes) && buildComplete(roofRes)
  const detail = `(walls: ${wallsRes}; roof: ${roofRes}; doorway: ${doorRes}${notes.length ? `; ${notes.join('; ')}` : ''})`
  if (!done) return `shelter UNFINISHED, it has gaps and is not safe yet ${detail}`
  return `built shelter ${size}x${size}x${WALL_HEIGHT} with a doorway at ${doorX},${baseY},${minZ} ${detail}`
}

/** buildAction stopped by an abort ('aborted' or 'aborted after ...'). */
function isAborted(r) {
  return typeof r === 'string' && r.startsWith('aborted')
}

// 261012: an interrupted build used to fall through to "no shelter built:
// walls: aborted after 32 placed of 48 cells", which reads as a failure to
// build rather than a stop partway.
function abortedAt(part, res, wallsRes) {
  const done = wallsRes ? `; walls: ${wallsRes}` : ''
  return `shelter stopped partway while building the ${part}, it is not finished (${part}: ${res}${done})`
}

/** buildAction placed at least one block, or the span was already all there. */
function placedSome(r) {
  return /^built [1-9]\d* /.test(r) || buildComplete(r)
}

/** buildAction finished the whole span (every cell placed or already solid). */
function buildComplete(r) {
  return /^built \d+ placed, \d+ skipped \(already solid\), of \d+ cells$/.test(r)
}
