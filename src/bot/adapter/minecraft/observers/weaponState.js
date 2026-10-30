// 261030 (quality pass 31): mark a mob-fight event as unarmed when the turn is
// written.
//
// In the combat_night eval, a first death dropped her sword at the river, and
// every hit, defend and threat turn after it still told her to attackEntity
// the mob or that her reflexes would swing back. Bare hands do 1 damage a
// swing, so she ran at drowned and zombies and died again (13 of 18 deaths in
// the two worst runs came unarmed, one run had 10). Whether she owns a weapon
// is read here, at the moment the event text is chosen (she may have picked
// her sword back up since the event fired), and the prompt library picks the
// get-away wording when she has none (promptLibrary ATTACKED_ADDENDUM,
// DEFEND_ADDENDUM). Armed turns get the event data back unchanged.

import { chooseWeapon } from '../behaviors/weaponSelect.js'

/**
 * @param {any} bot
 * @param {string} event
 * @param {any} data  the onAttacked payload (fsmWires)
 * @returns {any} data, or a copy with `unarmed: true`
 */
export function withWeaponState(bot, event, data) {
  if (event !== 'sei:attacked' || !data || typeof data !== 'object') return data
  const kind = data.attackerKind
  // A player hit (spar or not), a reflex dodge and a survival takeover keep
  // their own wording.
  if (kind === 'player' || kind === 'players' || kind === 'reflex' || data.survivalKind) return data
  // No readable inventory (an inert or test bot): say nothing about weapons.
  if (typeof bot?.inventory?.items !== 'function') return data
  let unarmed = false
  try { unarmed = chooseWeapon(bot) == null } catch { return data }
  return unarmed ? { ...data, unarmed: true } : data
}
