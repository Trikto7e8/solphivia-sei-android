// scripts/quality-eval/goals/scenarios.mjs: scripted goal-lifecycle scenarios
// for the text-only goal eval (run.mjs), one set per game.
//
// Every scenario is a list of steps. A step is what wakes the brain (a player
// line or a quiet idle tick), how the world looks at that moment (applied to
// the real adapter's observation state, so the real snapshot composer and the
// real progression frontier read it), and what any world action the model
// calls during the step returns. The model's own setGoal / clearGoal calls run
// for real against a real HEARTBEAT file; scoring reads that file after each
// step.
//
// The five scenario kinds, the same in every game:
//   task      greet, a multi-step task from the player, a step finishes, the
//             task finishes. Recorded? kept after a step? cleared at the end?
//   change    greet, a multi-step task, then the player switches to a
//             different multi-step plan. Old goal replaced, new one recorded?
//   done_said the heartbeat holds the player's task; the player says they
//             finished it themselves. Cleared?
//   stale     the heartbeat holds a task whose finish condition the snapshot
//             shows is met; a quiet idle tick. Cleared, and not resumed?
//   oneshot   greet, then a one-step request. No goal recorded for it?
//
// `match` is the regex that identifies the scenario's task in a goal line.

export const PLAYER = { minecraft: 'Alex', stardew: 'Ouen', dontstarve: 'Ouen' }

const idle = (quietMs = 30000) => ({ event: 'sei:idle', data: { reason: 'idle', quietMs } })
const greet = () => ({ event: 'sei:idle', data: { reason: 'just_connected_first_spawn' } })
const chat = (game, text) => ({ event: 'player_chat', data: { username: PLAYER[game], text, playerSpoke: true } })

// ── Minecraft ──────────────────────────────────────────────────────────────
// World state for Minecraft is the stub bot's inventory (read by the real
// progression frontier) plus a few snapshot lines.
const MC_HUT_GOAL = 'Build a small 5x5 oak hut with Alex by the river: chop logs, make a crafting table, then walls and a roof. Finish when the hut walls and roof are done.'
const mcStart = { inv: [], last: '(none)', blocks: ['#1 grass_block x412 @111,70,-40', '#2 oak_log x14 @118,72,-47', '#3 water x30 @104,70,-52'] }

const MC = {
  task: {
    match: /\b(hut|house|shelter|cabin)\b/i,
    steps: [
      { wake: greet(), world: mcStart },
      {
        wake: chat('minecraft', 'ok heres the plan. chop like 10 logs, make a crafting table, then build us a little 5x5 hut right here by the river'),
        world: mcStart,
        result: 'gather: collected 10 oak_log',
        afterWorld: { inv: [['oak_log', 10]] },
      },
      {
        // the logs are in; the bot crafts the table on its own
        wake: idle(), world: { inv: [['oak_log', 10]], last: 'gather: collected 10 oak_log' },
        result: 'craft: crafted 1 crafting_table and placed it at 113,71,-41',
        afterWorld: { inv: [['oak_log', 6], ['oak_planks', 4], ['crafting_table', 1]] },
      },
      {
        wake: idle(),
        world: {
          inv: [['oak_planks', 2], ['crafting_table', 1]],
          last: 'build: placed 48 oak_planks (5x5 hut walls and roof, done)',
          blocks: ['#1 oak_planks x48 @110,71,-42 (the hut you just built)', '#2 grass_block x400 @111,70,-40', '#3 water x30 @104,70,-52'],
        },
        result: 'done',
      },
    ],
  },
  change: {
    match: /\b(hut|house|shelter|cabin)\b/i,
    matchNew: /\b(iron|mine|mining|stone pickaxe|cave)\b/i,
    steps: [
      { wake: greet(), world: mcStart },
      { wake: chat('minecraft', 'ok heres the plan. chop like 10 logs, make a crafting table, then build us a little 5x5 hut right here by the river'), world: mcStart, result: 'gather: collected 4 oak_log (still going)' },
      {
        wake: chat('minecraft', 'actually forget the hut. lets go mining instead, make a stone pickaxe and go find some iron in that cave'),
        world: { inv: [['oak_log', 4]], last: 'gather: collected 4 oak_log' },
        result: 'craft: crafted 1 wooden_pickaxe',
      },
    ],
  },
  done_said: {
    match: /\b(hut|house|shelter|cabin)\b/i,
    heartbeat: [MC_HUT_GOAL],
    steps: [
      { wake: chat('minecraft', 'ok i finished the roof myself while you were gone, the hut is done. looks sick'), world: { inv: [['oak_planks', 6]], last: 'gather: collected 6 oak_log' } },
    ],
  },
  stale: {
    match: /\b(hut|house|shelter|cabin)\b/i,
    heartbeat: [MC_HUT_GOAL],
    steps: [
      {
        wake: idle(45000),
        world: {
          inv: [['oak_planks', 2], ['crafting_table', 1]],
          last: 'build: placed 48 oak_planks (5x5 hut walls and roof, done)',
          blocks: ['#1 oak_planks x48 @110,71,-42 (the hut you just built)', '#2 grass_block x400 @111,70,-40', '#3 water x30 @104,70,-52'],
        },
      },
    ],
  },
  oneshot: {
    match: /\b(come|over here|to you|to alex)\b/i,
    steps: [
      { wake: greet(), world: mcStart },
      { wake: chat('minecraft', 'come over here real quick'), world: mcStart, result: 'goTo: arrived next to Alex' },
    ],
  },
}

// ── Stardew ────────────────────────────────────────────────────────────────
// World state is a patch on the obs-farm.json fixture (spring 3, the farmer
// Ouen is the host). `counts` patches obs.tiles.counts, `farm` sets obs.farm
// (the frontier's crop and soil count), `inv` replaces matching inventory rows.
const SD_PLANT_GOAL = 'Plant the 15 parsnip seeds with Ouen by the farmhouse and water them. Finish when all 15 are planted and watered.'
const sdStart = { counts: { weeds: 9, twigs: 3, stones: 5, crops: 0, dryCrops: 0, emptySoil: 0 }, farm: { crops: 0, soil: 0 }, inv: { 'Parsnip Seeds': 15 } }
// obs.farm.soil is TILLED EMPTY soil, so a planted plot has soil 0.
const sdPlanted = { counts: { weeds: 0, twigs: 0, stones: 0, crops: 15, dryCrops: 0, readyCrops: 0, emptySoil: 0 }, farm: { crops: 15, soil: 0, dryCrops: 0 }, inv: { 'Parsnip Seeds': 0 } }

const SD = {
  task: {
    match: /\bparsnip/i,
    steps: [
      { wake: greet(), world: sdStart },
      {
        wake: chat('stardew', "ok lets get the farm going. clear the weeds and stones by the house, till a plot, plant these parsnip seeds, and then water them"),
        world: sdStart,
        result: 'cleared 9 weeds, 3 twigs and 5 stones beside the farmhouse',
        afterWorld: { counts: { weeds: 0, twigs: 0, stones: 0, crops: 0, emptySoil: 0 }, farm: { crops: 0, soil: 0 }, inv: { 'Parsnip Seeds': 15 } },
      },
      {
        wake: idle(),
        world: { counts: { weeds: 0, twigs: 0, stones: 0, crops: 0, emptySoil: 15 }, farm: { crops: 0, soil: 15 }, inv: { 'Parsnip Seeds': 15 }, last: 'tilled 15 tiles beside the farmhouse' },
        result: 'planted 15 Parsnip Seeds',
        afterWorld: { counts: { weeds: 0, twigs: 0, stones: 0, crops: 15, dryCrops: 15, emptySoil: 0 }, farm: { crops: 15, soil: 0, dryCrops: 15 }, inv: { 'Parsnip Seeds': 0 } },
      },
      { wake: idle(), world: { ...sdPlanted, last: 'watered 15 crops (all the parsnips are watered)' }, result: 'done' },
    ],
  },
  change: {
    match: /\bparsnip/i,
    matchNew: /\b(mine|mines|copper)\b/i,
    steps: [
      { wake: greet(), world: sdStart },
      { wake: chat('stardew', "ok lets get the farm going. clear the weeds and stones by the house, till a plot, plant these parsnip seeds, and then water them"), world: sdStart, result: 'cleared 4 weeds beside the farmhouse (stopped)' },
      {
        wake: chat('stardew', 'actually forget the farm for today. the mines just opened, lets go down to level 5 together and grab some copper'),
        world: { counts: { weeds: 5, twigs: 3, stones: 5, crops: 0, emptySoil: 0 }, farm: { crops: 0, soil: 0 }, inv: { 'Parsnip Seeds': 15 }, last: 'cleared 4 weeds beside the farmhouse' },
        result: 'walking to the mines',
      },
    ],
  },
  done_said: {
    match: /\bparsnip/i,
    heartbeat: [SD_PLANT_GOAL],
    steps: [
      { wake: chat('stardew', 'i planted and watered all the parsnips myself this morning, so thats done. thanks tho'), world: { ...sdPlanted, inv: { 'Parsnip Seeds': 15 } } },
    ],
  },
  stale: {
    match: /\bparsnip/i,
    heartbeat: [SD_PLANT_GOAL],
    steps: [{ wake: idle(45000), world: { ...sdPlanted, last: 'watered 15 crops (all the parsnips are planted and watered)' } }],
  },
  oneshot: {
    match: /\bwater/i,
    steps: [
      { wake: greet(), world: { counts: { crops: 12, dryCrops: 12, emptySoil: 0 }, farm: { crops: 12, soil: 0, dryCrops: 12 } } },
      { wake: chat('stardew', 'can you water the crops for me?'), world: { counts: { crops: 12, dryCrops: 12, emptySoil: 0 }, farm: { crops: 12, soil: 0, dryCrops: 12 } }, result: 'watered 12 crops' },
    ],
  },
}

// ── Don't Starve Together ──────────────────────────────────────────────────
// World state patches the fake-dst-mod frame: `inv` (prefab -> count) replaces
// the bag, `structures` adds structure entities near camp, `drop` removes
// entity prefabs, `phase` sets the day phase.
const DST_SCIENCE_GOAL = 'Build a science machine near camp with Ouen: mine rocks and gold, chop logs. Finish when the science machine is built.'
const dstStart = { inv: { axe: 1, log: 2, berries: 3, twigs: 2 }, drop: ['researchlab'] }

const DST = {
  task: {
    match: /\b(science|research|lab)\b/i,
    steps: [
      { wake: greet(), world: dstStart },
      {
        wake: chat('dontstarve', "we need a science machine. can you get rocks and gold and some logs and build it next to the fire?"),
        world: dstStart,
        result: 'chopped 4 logs',
        afterWorld: { inv: { axe: 1, log: 6, berries: 3, twigs: 2 }, drop: ['researchlab'] },
      },
      {
        // a step finished (rocks), the task is not done yet (no gold)
        wake: idle(),
        world: { inv: { axe: 1, pickaxe: 1, log: 6, rocks: 4, berries: 3 }, drop: ['researchlab'], last: 'mined 4 rocks (no gold in this boulder)' },
        result: 'mined 1 gold nugget',
        afterWorld: { inv: { axe: 1, pickaxe: 1, log: 6, rocks: 4, goldnugget: 1, berries: 3 }, drop: ['researchlab'] },
      },
      {
        wake: idle(),
        world: { inv: { axe: 1, pickaxe: 1, log: 6, rocks: 4, goldnugget: 1, berries: 3 }, drop: ['researchlab'], last: 'mined 1 gold nugget' },
        result: 'built researchlab at camp',
        afterWorld: { inv: { axe: 1, pickaxe: 1, log: 2, berries: 3 }, structures: ['researchlab'] },
      },
      { wake: idle(), world: { inv: { axe: 1, pickaxe: 1, log: 2, berries: 3 }, structures: ['researchlab'], last: 'built researchlab at camp (the science machine is up)' }, result: 'done' },
    ],
  },
  change: {
    match: /\b(science|research|lab)\b/i,
    matchNew: /\b(camp|fire ?pit|torch|grass)\b/i,
    steps: [
      { wake: greet(), world: dstStart },
      { wake: chat('dontstarve', "we need a science machine. can you get rocks and gold and some logs and build it next to the fire?"), world: dstStart, result: 'chopped 2 logs (stopped)' },
      {
        wake: chat('dontstarve', "actually forget the science machine, its getting dark. lets set up a camp first: make a torch, get grass and twigs, and build a fire pit"),
        world: { inv: { axe: 1, log: 4, berries: 3, twigs: 2 }, drop: ['researchlab'], phase: 'dusk', last: 'chopped 2 logs' },
        result: 'picked 3 cut grass',
      },
    ],
  },
  done_said: {
    match: /\b(science|research|lab)\b/i,
    heartbeat: [DST_SCIENCE_GOAL],
    steps: [{ wake: chat('dontstarve', 'i built the science machine myself while you were chopping, its done. its right by the fire'), world: { inv: { axe: 1, log: 6, berries: 3 }, structures: ['researchlab'] } }],
  },
  stale: {
    match: /\b(science|research|lab)\b/i,
    heartbeat: [DST_SCIENCE_GOAL],
    steps: [{ wake: idle(45000), world: { inv: { axe: 1, pickaxe: 1, log: 2, berries: 3 }, structures: ['researchlab'], last: 'built researchlab at camp (the science machine is up)' } }],
  },
  oneshot: {
    match: /\b(berr|food|give)/i,
    steps: [
      { wake: greet(), world: dstStart },
      { wake: chat('dontstarve', 'can you give me some berries? im starving'), world: dstStart, result: 'gave 3 berries to Ouen' },
    ],
  },
}

export const SCENARIOS = { minecraft: MC, stardew: SD, dontstarve: DST }
export const SCENARIO_IDS = ['task', 'change', 'done_said', 'stale', 'oneshot']
