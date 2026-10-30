// 261030 (quality pass 31): fight events say so when she owns no weapon.
//
// combat_night eval: a first death dropped her sword, and every hit, defend
// and threat turn after it still told her to attackEntity the mob. She fought
// bare-handed and died again (13 of 18 deaths in the two worst runs).

import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { Vec3 } from 'vec3'
import { withWeaponState } from './weaponState.js'
import { staleAttackerText } from './staleAttacker.js'
import { trackEntityDeaths } from './entities.js'
import {
  eventAddendum, ATTACKED_ADDENDUM_MOB, attackedMobUnarmed,
} from '../../../brain/promptLibrary.js'
import { deathAddendum } from '../prompts.js'

const botWith = (items) => ({ inventory: { items: () => items.map((name) => ({ name, count: 1 })) } })
const zombie = { id: 7, name: 'zombie', isValid: true }

describe('withWeaponState', () => {
  it('marks a mob hit, defend and threat event unarmed only when she owns no weapon', () => {
    const empty = botWith(['bread', 'dirt'])
    for (const kind of ['hostile_mob', 'mob', 'defend']) {
      expect(withWeaponState(empty, 'sei:attacked', { attackerKind: kind }).unarmed).toBe(true)
    }
    for (const w of ['stone_sword', 'iron_axe', 'trident']) {
      const d = { attackerKind: 'hostile_mob' }
      expect(withWeaponState(botWith([w]), 'sei:attacked', d)).toBe(d)
    }
  })

  it('leaves player hits, reflex and survival turns, other events and inert bots alone', () => {
    const empty = botWith([])
    for (const d of [{ attackerKind: 'player' }, { attackerKind: 'reflex' }, { attackerKind: 'reflex', survivalKind: 'drowning' }]) {
      expect(withWeaponState(empty, 'sei:attacked', d)).toBe(d)
    }
    const idle = { quietMs: 5000 }
    expect(withWeaponState(empty, 'sei:idle', idle)).toBe(idle)
    const d = { attackerKind: 'hostile_mob' }
    expect(withWeaponState({}, 'sei:attacked', d)).toBe(d)
  })
})

describe('unarmed event text', () => {
  it('a mob hit: the armed text keeps the stand-your-ground offer, the unarmed one says get away', () => {
    const armed = eventAddendum('sei:attacked', { attackerLabel: 'drowned', attackerKind: 'hostile_mob' })
    const bare = eventAddendum('sei:attacked', { attackerLabel: 'drowned', attackerKind: 'hostile_mob', unarmed: true })
    expect(armed).toBe(ATTACKED_ADDENDUM_MOB.replace('{label}', 'drowned'))
    expect(bare).toBe(attackedMobUnarmed().replace('{label}', 'drowned'))
    expect(bare).toMatch(/no weapon/)
    expect(bare).not.toMatch(/swing back on their own/)
    expect(attackedMobUnarmed().slice(attackedMobUnarmed().indexOf(' Then:'))).not.toMatch(/—/)
  })

  it('a threat on the player: unarmed says do not attackEntity it', () => {
    const data = { attackerLabel: 'zombie', attackerKind: 'defend', threat: true, count: 2, ownerLabel: 'Alex', distance: 11, ownerDistance: 8 }
    const armed = eventAddendum('sei:attacked', data)
    const bare = eventAddendum('sei:attacked', { ...data, unarmed: true })
    expect(armed).toMatch(/Call attackEntity on it now/)
    expect(bare).toMatch(/^2 hostiles are closing in on Alex: the nearest is 8 blocks from them and 11 blocks from you\. You have no weapon/)
    expect(bare).toMatch(/Do not attackEntity it/)
    expect(bare).not.toMatch(/—/)
  })

  it('a held defend turn: unarmed swaps the attack advice; her own running attack keeps its wording', () => {
    const data = { attackerLabel: 'zombie', attackerKind: 'defend', ownerLabel: 'Alex', distance: 5, engaged: false }
    expect(eventAddendum('sei:attacked', data)).toMatch(/attackEntity it to pull it off them/)
    const bare = eventAddendum('sei:attacked', { ...data, unarmed: true })
    expect(bare).toMatch(/^Alex is being hit by zombie \(5 blocks from you\)\. You have no weapon/)
    const action = { ...data, engaged: true, actionOnIt: true }
    expect(eventAddendum('sei:attacked', { ...action, unarmed: true })).toBe(eventAddendum('sei:attacked', action))
  })
})

describe('death that dropped a weapon', () => {
  it('names the weapon and what it means', () => {
    const t = deathAddendum({ pos: { x: 1, y: 2, z: 3 }, lost: [{ item: 'bread', n: 3 }, { item: 'stone_sword', n: 1 }, { item: 'wooden_axe', n: 1 }] })
    expect(t).toMatch(/That includes your stone_sword, so you have no weapon until you get it back/)
  })
  it('says nothing about weapons when none dropped', () => {
    const t = deathAddendum({ pos: { x: 1, y: 2, z: 3 }, lost: [{ item: 'bread', n: 3 }] })
    expect(t).not.toMatch(/weapon/)
  })
})

describe('staleAttackerText covers her own hits (hostile_mob)', () => {
  it('replaces a hit event whose mob died before the turn', () => {
    const bot = new EventEmitter()
    bot.entity = { position: new Vec3(0, 64, 0) }
    bot.entities = {}
    trackEntityDeaths(bot)
    const z = { ...zombie, type: 'hostile', position: new Vec3(2, 64, 0) }
    bot.entities[7] = z
    const data = { attacker: z, attackerLabel: 'zombie', attackerKind: 'hostile_mob' }
    expect(staleAttackerText(bot, 'sei:attacked', data)).toBeNull()
    bot.emit('entityDead', z)
    expect(staleAttackerText(bot, 'sei:attacked', data)).toMatch(/^A zombie went for you a moment ago, and it has died since then/)
  })
})
