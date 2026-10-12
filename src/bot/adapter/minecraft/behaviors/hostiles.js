// Shared hostile-mob name set. Hoisted out of combat.js so both the
// reactive-after-damage loop (combat.js, entityHurt-driven) and the
// before-damage reflex loop (reflex.js, physicsTick-driven) classify the same
// mobs without duplicating the literal. The 26 names are the vanilla hostile
// roster the bot may need to evade or retaliate against.
export const HOSTILE_MOBS = new Set([
  'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider', 'witch',
  'blaze', 'ghast', 'slime', 'phantom', 'drowned', 'husk', 'stray',
  'pillager', 'vindicator', 'evoker', 'ravager', 'enderman', 'endermite',
  'silverfish', 'guardian', 'elder_guardian', 'wither_skeleton', 'hoglin',
  'piglin_brute', 'zoglin',
])

// Mobs the bot must never walk into melee range of on its own initiative:
// closing on a creeper is how you set it off, and the rest hit too hard or
// fly. Used by the automatic owner defense (combat.js) and by attackEntity's
// follow-on target after a kill (attack.js). An explicit attackEntity on one
// of these by the model is still allowed.
export const NO_MELEE_DEFEND = new Set(['creeper', 'ghast', 'blaze', 'elder_guardian', 'ravager', 'warden'])
