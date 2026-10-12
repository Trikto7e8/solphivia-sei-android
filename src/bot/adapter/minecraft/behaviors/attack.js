// src/behaviors/attack.js — multi-swing attack on an entity (D-22, Pitfall 5)
import pkg from 'mineflayer-pathfinder'
import { resolveEntity, isStaleHandle, nearestNamedEntityBeyondBound, handleForEntity, pickHostileForOwner, ownerEntityOf } from '../observers/targeting.js'
import { HOSTILE_MOBS, NO_AUTO_ENGAGE } from './hostiles.js'
import { isDeadEntity } from '../observers/entities.js'
import { reason } from '../../../brain/errStrings.js'
import { equipBestWeapon } from './weaponSelect.js'
import { companionMovements } from './pathfind.js'
import { followMovements } from './follow.js'
import { noteCombat } from './autoEat.js'

const { goals } = pkg

export const DEFAULT_TIMEOUT_MS = 12000
const REACH = 3.5
// Dynamic GoalFollow range while closing on a MOVING target. Kept below REACH
// (3.5) so pathfinder actually parks the bot inside swing range on a kiting mob.
const PURSUE_FOLLOW_RANGE = 2
const PURSUE_POLL_MS = 100       // pursuit loop cadence: re-check distance / re-assert goal
const SWING_DELAY_MS = 600       // matches mob attack cooldown; faster spams hits without damage
const DEATH_PACKET_WAIT_MS = 250 // after the last swing, before calling the target alive

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// At or below this health a mob fight is two hits from death. 261011
// (combat_night eval): at 4hp she kept swinging at a skeleton while the
// player begged her to come back, and died. Critical-HP auto-retreat is off
// on purpose (survival.js, 260707), so the decision stays with the model;
// attackEntity just stops trading hits and says why.
export const CRITICAL_HP = 6
const CRITICAL_ADVICE = 'Get away first (follow the player, or goTo somewhere away from it), eat if you have food, then fight'

// Anti-stuck movement tuning shared with goTo (pathfind.js): make digging a
// last resort so pursuit routes around obstacles rather than tunnelling.
// Sprinting stays ON here, unlike goTo/follow: a chase has to close distance
// on a mob that is moving away (a skeleton backs off to shoot). With pursuit
// at a walk, the pass-2 combat_night eval had four "couldn't catch ... it
// kept its distance" (pass 1b: none), and one 12s skeleton chase took her
// from 16 to 4 health before she died. The corner wedge that sprint causes
// costs a 3.5s path reset on a walk; on a chase the goal moves every tick.
export function pursuitMovements(bot) {
  const m = companionMovements(bot)
  m.allowSprinting = true
  return m
}

function inStaggerWindow(bot) {
  return bot._seiStaggerUntil != null && Date.now() < bot._seiStaggerUntil
}

/**
 * Close on a MOVING entity with a DYNAMIC follow goal until within `reach`, the
 * `deadline` elapses, or the target dies/despawns. The old code snapshotted a
 * STATIC coordinate and pathed to it for one 2.5s budget, so a kiting skeleton
 * outran the stale point and the bot gave up after a single chase. GoalFollow
 * with dynamic=true lets pathfinder recompute toward the LIVE entity every tick,
 * so the target is actually run down under the caller's overall timeout.
 *
 * Goal ownership (see attackEntityAction finally): the pursuit installs its own
 * goal, so it YIELDS to a creeper-flee that owns the goal (bot._seiReflexActive)
 * and to a player-knockback stagger window, re-asserting once either clears. The
 * caller's finally releases sprint + the goal.
 *
 * Returns 'reached' | 'gone' | 'timeout' | 'aborted'.
 */
async function pursueUntilInReach(bot, entityId, reach, deadline, signal) {
  let goalOwned = false
  let ourGoal = null
  while (true) {
    if (signal?.aborted) return 'aborted'
    if (Date.now() > deadline) return 'timeout'
    const live = bot.entities?.[entityId]
    if (!live || !live.position) return 'gone'
    const dist = bot.entity?.position?.distanceTo?.(live.position)
    if (typeof dist === 'number' && dist <= reach) return 'reached'
    // Yield the goal to a creeper-flee (Plan 01 mutex), a survival takeover
    // (drowning swim-up / critical-HP retreat — survival.js re-asserts its flee
    // goal on any foreign goal_updated, so fighting it would just waste the
    // pursuit budget), or a stagger window; don't fight them tick-for-tick.
    // Re-assert once they clear.
    if (bot._seiReflexActive || bot._seiSurvivalActive || bot._seiCriticalRetreat || inStaggerWindow(bot)) {
      goalOwned = false
      await sleep(PURSUE_POLL_MS)
      continue
    }
    // 261012: re-install when something else replaced or cleared the goal
    // (a pathfinder.stop() from another behavior used to leave the chase
    // parked until its timeout, since the goal was only ever set once).
    if (goalOwned && ourGoal && bot.pathfinder?.goal !== ourGoal) goalOwned = false
    if (!goalOwned) {
      try {
        ourGoal = new goals.GoalFollow(live, PURSUE_FOLLOW_RANGE)
        bot.pathfinder.setGoal(ourGoal, true)
        goalOwned = true
      } catch (_) {}
    }
    await sleep(PURSUE_POLL_MS)
  }
}

// 260708: a mob that survives the whole batch while the bot swings a stick is
// invisible ineffectiveness — the model happily reports "i'm fighting" while
// doing ~1 damage (Lyra fought a zombie and a skeleton with a stick, at 4hp,
// while the player died twice). When the target is still alive and the held
// item is not a real weapon, say so, and point at the better move: equip the
// weapon already in the inventory if there is one, otherwise craft one.
const WEAPON_RE = /sword|_axe|trident|mace/
export function weakWeaponNote(bot) {
  const held = bot.heldItem?.name ?? null
  if (held && WEAPON_RE.test(held)) return ''
  let owned = null
  try {
    owned = (bot.inventory?.items?.() ?? []).find(it => it?.name && WEAPON_RE.test(it.name))?.name ?? null
  } catch { /* inventory unavailable — keep the generic note */ }
  const fix = owned
    ? `equip your ${owned}`
    : 'craft a weapon when you get the chance'
  return `; you're fighting with ${held ?? 'bare hands'}, which is slow: ${fix}`
}

// 261011 (quality pass 2): "the target left the entity table" is not "it
// died". A mob that walks out of tracking range or despawns disappears the
// same way, and the old result called that "killed zombie (3 hits)" (or the
// bare "target gone", which the model also read as a kill): in the
// combat_night eval she told the player a zombie or skeleton was dead five
// times while it was still around. Death is now only what the server says:
// the entity_status death event (mineflayer 'entityDead') for that entity id.
export function goneResult(name, hits, died) {
  if (died) return hits ? `killed ${name} (${hits} hits)` : `${name} died before you hit it`
  const lost = `lost sight of ${name}: it moved out of range or despawned, NOT confirmed dead, it may still be around`
  return hits ? `${hits} hits on ${name}, then ${lost}` : lost
}

// 261012: say where the nearest one is when a name lookup comes up empty.
// The name lookup stays bounded at 16 blocks (targeting.js); a #N handle is
// not, so that is the way to go after a mob that is farther out.
export function fartherNote(asked, bot) {
  let far = null
  try { far = nearestNamedEntityBeyondBound(asked, bot) } catch { far = null }
  if (!far) return ''
  const p = far.entity.position
  const at = `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}`
  const tag = handleForEntity(far.entity.id)
  const how = tag
    ? `To go after it, call attackEntity with target "${tag}"; it runs there on its own.`
    : 'To go after it, goTo near it first, then attackEntity.'
  return `. The nearest ${asked} is ${Math.round(far.distance)} blocks away at ${at}. ${how}`
}

export async function attackEntityAction(args, bot, config) {
  const signal = config?.signal
  if (signal?.aborted) return 'aborted'

  const entity = resolveEntity(args, bot)
  if (!entity) {
    if (isStaleHandle(args)) return 'stale target'
    const asked = typeof args?.entity === 'string' ? args.entity : (typeof args?.target === 'string' && !args.target.startsWith('#') ? args.target : null)
    if (!asked) return 'target gone'
    return `no ${asked} within 16 blocks to attack${fartherNote(asked, bot)}`
  }

  // Refuse Players unless PvP mode is ON (bot._seiPvp, toggled by the setPvp
  // tool). When OFF this keeps the original refusal + message; when ON the
  // player is a legal target so the companion can spar (Task 2a).
  if ((entity.type === 'player' || entity.username) && !bot._seiPvp) return 'cannot attack player — PvP spar mode is off; if they asked to fight/spar, call setPvp({enabled:true}) first, then attack'

  // Refuse item-class entities. Dropped items, xp
  // orbs, and global entities (lightning) cannot die — the dispatch wastes
  // iterations chasing them and the model never learns they are non-targets
  // unless we surface a clear refusal here. The `entity.name === 'item'`
  // check covers mineflayer versions where dropped items report differently.
  if (entity.type === 'object' || entity.name === 'item') {
    const label = entity.name === 'item' ? 'item' : (entity.name ?? 'object')
    return `cannot attack ${label} (dropped item entity)`
  }
  if (entity.type === 'orb') {
    return 'cannot attack xp orb'
  }
  if (entity.type === 'global') {
    return 'cannot attack global entity'
  }

  const name = entity.name ?? entity.displayName ?? 'entity'
  const mobTarget = !(entity.type === 'player' || entity.username)
  const startHp = bot.health
  if (mobTarget && Number.isFinite(startHp) && startHp <= CRITICAL_HP) {
    return `did not attack ${name}: you are at ${Math.round(startHp)} health, and one or two more hits will kill you. ${CRITICAL_ADVICE}`
  }
  // 261011: hold the best weapon owned before the first swing (mobs only).
  if (mobTarget) {
    try { await equipBestWeapon(bot) } catch {}
    if (signal?.aborted) return 'aborted'
  }
  const times = clampTimes(args.times)
  const timeoutMs = args.timeout_ms ?? config?.attack_timeout_ms ?? DEFAULT_TIMEOUT_MS
  // 261011 quality pass 2: death is only what the server says (entityDead),
  // tracked per entity id so a follow-on target (below) has its own record.
  const deadIds = new Set()
  const onDead = (e) => { if (e?.id != null) deadIds.add(e.id) }
  try { bot.on?.('entityDead', onDead) } catch (_) {}
  let currentId = entity.id
  try {
    // Set anti-stuck movements once for the whole engagement (pursueUntilInReach
    // installs GoalFollow against these). goTo resets movements on its next call.
    try { bot.pathfinder?.setMovements?.(pursuitMovements(bot)) } catch (_) {}
    // Owner defense: the first target is a hostile and the owner is known.
    // Then a second hostile near her gets one hit on the way (see tagOther).
    const ownerMode = mobTarget && HOSTILE_MOBS.has(name) && ownerEntityOf(bot) != null
    const ctx = { bot, signal, timeoutMs, startHp, deadIds, ownerMode, tagged: new Set([entity.id]), tags: 0 }
    let result = await fightOne(entity, times, ctx)
    // 261012 (pass 4a): a kill with swings left over while the player still
    // has a hostile on them goes straight on to that one. In the
    // protect_player eval the turn after the first kill took 1-2s (once it
    // only said "zombie's dead, you good?" and ended), and the second zombie
    // killed the 4 hp player in that gap.
    let left = times - result.hits
    while (result.died && left > 0 && HOSTILE_MOBS.has(name) && !signal?.aborted) {
      if (Number.isFinite(bot.health) && bot.health <= CRITICAL_HP) break
      const next = pickHostileForOwner(bot, (e) => !NO_AUTO_ENGAGE.has(e.name), {
        ownerRadius: CHAIN_OWNER_RADIUS, excludeIds: deadIds,
      }) ?? nearestTagged(bot, ctx)
      if (!next || next.id === currentId) break
      currentId = next.id
      ctx.tagged.add(next.id)
      const r = await fightOne(next, left, ctx)
      result = { ...r, text: `${result.text}. Then went for the next ${next.name ?? 'mob'}: ${r.text}` }
      left -= r.hits
    }
    if (ctx.tags > 0) {
      const one = ctx.tags === 1
      result = { ...result, text: `${result.text}. You also hit ${one ? 'another hostile' : `${ctx.tags} other hostiles`} once on the way, so ${one ? 'it should be' : 'they should be'} coming after you now` }
    }
    return result.text
  } finally {
    // Release the sprint + pursuit goal we installed. NEVER yank a creeper-flee's
    // goal (bot._seiReflexActive) OR a survival takeover's flee goal
    // (bot._seiSurvivalActive / _seiCriticalRetreat): those own the goal and
    // restore/re-assert it themselves, so nulling it here would just wipe an
    // active flee (survival re-asserts on goal_updated, but the wipe is a needless
    // race). When none is active, clearing to null lets the 1s follow tick
    // (follow.js) re-install GoalFollow(owner) if a follow target is set — the
    // single-owner restore convention.
    try { bot.setControlState?.('sprint', false) } catch (_) {}
    // Restore the default Movements. We swapped in pursuitMovements (digCost=8,
    // maxDropDown=4) globally for the chase; the pathfinder keeps whatever
    // Movements were last set, and follow.js installs its bare `new Movements`
    // only ONCE at startFollow (it re-installs GoalFollow each tick WITHOUT
    // resetting movements). So without this the companion would trail with
    // pursuit movements (permitting larger drops) after every fight until the
    // next goTo() reset them. Reset here so they never leak past the engagement.
    try { bot.pathfinder?.setMovements?.(followMovements(bot)) } catch (_) {}
    if (!bot._seiReflexActive && !bot._seiSurvivalActive && !bot._seiCriticalRetreat) {
      try { bot.pathfinder?.setGoal?.(null) } catch (_) {}
    }
    if (bot._seiOffensiveTarget === currentId) bot._seiOffensiveTarget = null
    try { bot.removeListener?.('entityDead', onDead) } catch (_) {}
  }
}

// After a kill, attackEntity moves on to a hostile within this many blocks of
// the player (the owner-threat watch radius, combat.js).
const CHAIN_OWNER_RADIUS = 12

// 261012 (pass 4a): a mob only turns on whoever hits it, so while she fights
// one, a second hostile walks on to the player. In the protect_player eval
// the second zombie reached the 10 hp player in every trial, and the
// successes ended with the player at 1-4 hp. One hit on it on the way moves
// it onto her as well.
const TAG_RADIUS = 6       // only a mob this close to her (a step or two away)
const TAG_CHASE_MS = 2000  // and only if she reaches it this fast

/**
 * Give one hit to a hostile near her that she has not hit yet in this action
 * and that is near the owner (pickHostileForOwner's radius). Returns true when
 * a swing landed. Restores this action's offensive-target flag either way.
 */
async function tagOther(currentId, ctx) {
  const { bot, signal, deadIds, tagged } = ctx
  const me = bot.entity?.position
  if (!me) return false
  const exclude = new Set([...deadIds, ...tagged, currentId])
  const other = pickHostileForOwner(bot, (e) => {
    if (NO_AUTO_ENGAGE.has(e.name)) return false
    try { return e.position.distanceTo(me) <= TAG_RADIUS } catch { return false }
  }, { excludeIds: exclude })
  if (!other) return false
  tagged.add(other.id)
  bot._seiOffensiveTarget = other.id
  try {
    const d = me.distanceTo(other.position)
    if (d > REACH) {
      const res = await pursueUntilInReach(bot, other.id, REACH, Date.now() + TAG_CHASE_MS, signal)
      if (res !== 'reached') return false
    }
    const live = bot.entities?.[other.id]
    if (!live || deadIds.has(other.id)) return false
    bot.lookAt?.(live.position.offset(0, live.height ? live.height * 0.5 : 0.5, 0), true)
    bot.attack(live)
    noteCombat(bot)
    bot.swingArm?.()
    ctx.tags++
    return true
  } catch {
    return false
  } finally {
    // Only restore our own flag: a newer attack may have claimed it meanwhile.
    if (bot._seiOffensiveTarget === other.id) bot._seiOffensiveTarget = currentId
  }
}

/** The nearest living mob she hit in this action (it is coming for her), within 16 blocks. */
function nearestTagged(bot, ctx) {
  const me = bot.entity?.position
  if (!me) return null
  let best = null
  for (const id of ctx.tagged) {
    if (ctx.deadIds.has(id)) continue
    const e = bot.entities?.[id]
    if (!e?.position || isDeadEntity(bot, e)) continue
    let d
    try { d = e.position.distanceTo(me) } catch { continue }
    if (Number.isFinite(d) && d <= 16 && (!best || d < best.d)) best = { e, d }
  }
  return best?.e ?? null
}

/**
 * Swing at one entity up to `times` times: chase it into reach, swing, stop on
 * death, a lost target, the timeout, an abort or critical health. Returns the
 * result text, the swings landed and whether the server reported its death.
 */
async function fightOne(entity, times, ctx) {
  const { bot, signal, timeoutMs, startHp, deadIds } = ctx
  const name = entity.name ?? entity.displayName ?? 'entity'
  const mobTarget = !(entity.type === 'player' || entity.username)
  const entityId = entity.id
  const isPlayerTarget = entity.type === 'player' || entity.username != null
  const startedAt = Date.now()
  let hits = 0
  const died = () => deadIds.has(entityId)
  const done = (text) => ({ text, hits, died: died() })

  // Mark this mob as the deliberate offensive target so the survival reflex
  // (reflex.js) suppresses its melee circle-strafe while we are actively
  // attacking it — otherwise the reflex fights our own lookAt/positioning.
  // Cleared by the caller's finally (guarded so a newer attack's flag is
  // never clobbered).
  bot._seiOffensiveTarget = entityId
  // Attacking a player IS a PvP exchange — lock them as the reflex opponent
  // (Task 2) so reflex.js kites this player and only this player. The `at`
  // refreshes on each swing below and decays ~10s after the last blow.
  if (isPlayerTarget && bot._seiPvp) bot._seiPvpOpponent = { id: entityId, at: Date.now() }

  for (let i = 0; i < times; i++) {
    if (signal?.aborted) {
      return done(hits ? `aborted after ${hits}/${times} hits on ${name}` : 'aborted')
    }
    if (Date.now() - startedAt > timeoutMs) {
      return done(hits ? `timeout after ${hits}/${times} hits on ${name}` : `timeout attacking ${name}`)
    }

    // A dead mob stays in the entity table for its ~1s death animation;
    // stop swinging at the corpse once the server has said it died.
    if (died()) return done(goneResult(name, hits, true))

    let live = bot.entities?.[entityId]
    if (!live) return done(goneResult(name, hits, died()))

    const dist = bot.entity?.position?.distanceTo?.(live.position)
    if (typeof dist === 'number' && dist > REACH) {
      // Chase the LIVE entity with a dynamic follow goal until in reach. The
      // overall timeout (deadline) is the ONLY give-up condition — no more
      // single-budget surrender on a kiting mob.
      const deadline = startedAt + timeoutMs
      const res = await pursueUntilInReach(bot, entityId, REACH, deadline, signal)
      if (res === 'aborted') return done(hits ? `aborted after ${hits}/${times} hits on ${name}` : 'aborted')
      if (res === 'gone') return done(goneResult(name, hits, died()))
      if (res === 'timeout') {
        return done(hits
          ? `${hits}/${times} hits, then ${name} kept its distance until time ran out`
          : `couldn't catch ${name} — it kept its distance`)
      }
      // res === 'reached'
      live = bot.entities?.[entityId]
      if (!live) return done(goneResult(name, hits, died()))
    }

    // Owner defense: before the next swing at this mob (it already took one
    // and is after her now), give a second hostile near her one hit too.
    if (i > 0 && ctx.ownerMode) {
      const tagged = await tagOther(entityId, ctx)
      if (signal?.aborted) return done(`aborted after ${hits}/${times} hits on ${name}`)
      if (tagged) {
        const waited = await sleepOrAbort(SWING_DELAY_MS, signal)
        if (waited === 'aborted') return done(`aborted after ${hits}/${times} hits on ${name}`)
        if (died()) return done(goneResult(name, hits, true))
        live = bot.entities?.[entityId]
        if (!live) return done(goneResult(name, hits, died()))
        const d2 = bot.entity?.position?.distanceTo?.(live.position)
        if (typeof d2 === 'number' && d2 > REACH) {
          const res = await pursueUntilInReach(bot, entityId, REACH, startedAt + timeoutMs, signal)
          if (res === 'aborted') return done(`aborted after ${hits}/${times} hits on ${name}`)
          if (res === 'gone') return done(goneResult(name, hits, died()))
          if (res === 'timeout') return done(`${hits}/${times} hits, then ${name} kept its distance until time ran out`)
          live = bot.entities?.[entityId]
          if (!live) return done(goneResult(name, hits, died()))
        }
      }
    }

    // Stop trading hits once this fight has brought her to critical health.
    const hp = bot.health
    if (mobTarget && Number.isFinite(hp) && hp <= CRITICAL_HP && hp < startHp) {
      return done(`${hits}/${times} hits on ${name}, then stopped: you are down to ${Math.round(hp)} health. ${CRITICAL_ADVICE}`)
    }
    // Re-equip before every swing: auto-eat or a placed block may have
    // changed the hand since the first one (no-op when already held).
    if (mobTarget && !bot.autoEat?.isEating) {
      try { await equipBestWeapon(bot) } catch {}
      if (signal?.aborted) return done(hits ? `aborted after ${hits}/${times} hits on ${name}` : 'aborted')
    }

    try {
      bot.lookAt?.(live.position.offset(0, live.height ? live.height * 0.5 : 0.5, 0), true)
      bot.attack(live)
      noteCombat(bot)
      bot.swingArm?.()
      hits++
      // Refresh the PvP opponent lock on every swing so the reflex keeps
      // kiting this player through the exchange (decays ~10s after the last).
      if (isPlayerTarget && bot._seiPvp) bot._seiPvpOpponent = { id: entityId, at: Date.now() }
    } catch (err) {
      const r = reason(err)
      return done(hits
        ? `${hits}/${times} hits then attack failed (${name}): ${r ?? 'unknown'}`
        : (r ? `attack failed (${name}): ${r}` : `attack failed (${name})`))
    }

    if (i < times - 1) {
      const waited = await sleepOrAbort(SWING_DELAY_MS, signal)
      if (waited === 'aborted') return done(`aborted after ${hits}/${times} hits on ${name}`)
    }
  }

  // A spar against a player is a running exchange, not a completed task: frame
  // the result so the model keeps fighting instead of narrating an ending.
  // The last swing can be the killing one: give the death packet a moment
  // so a kill is not reported as "still alive".
  if (!isPlayerTarget && !died()) await sleepOrAbort(DEATH_PACKET_WAIT_MS, signal)
  if (!isPlayerTarget && (died() || !bot.entities?.[entityId])) return done(goneResult(name, hits, died()))
  if (isPlayerTarget) return done(`attacked ${name} ${hits}× — they're still standing and the spar is still ON; keep it going (attack again, reposition, trash-talk) until they say stop`)
  return done(`attacked ${name} ${hits}× (target still alive)${weakWeaponNote(bot)}`)
}

function clampTimes(t) {
  const n = Number.isFinite(t) ? Math.floor(t) : 1
  if (n < 1) return 1
  if (n > 10) return 10
  return n
}

function sleepOrAbort(ms, signal) {
  return new Promise((resolve) => {
    let done = false
    const timer = setTimeout(() => { if (!done) { done = true; resolve('done') } }, ms)
    if (signal) {
      const onAbort = () => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve('aborted')
      }
      if (signal.aborted) { onAbort(); return }
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}
