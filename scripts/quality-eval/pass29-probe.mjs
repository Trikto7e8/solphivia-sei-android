// scripts/quality-eval/pass29-probe.mjs: the pass 21 probe harness
// (pass21-probe.mjs) with the pass 29 repeat cases, taken word for word from
// the 2026-10-27 scorecard-dev scripted conversations. The REAL brain
// (createOrchestrator + handleDispatch, the real Minecraft adapter on an
// inert bot), earlier turns stubbed with her real lines, only the measured
// turn goes to the API, on a virtual clock.
//
// In every case the line she reused was one of her last four turns, quoted in
// the own_repeats note right above the reply, under the ask not to reuse it.
//   useless_tree  work_session-01 U14: "honestly ur useless" two turns after
//                 "i punched a tree with my BARE HANDS in a language model
//                 body". bad = the tree/bare hands bit again, or a 3-word run.
//   logs_proof    work_session-01 U17 (mid-follow): "thanks for the help"
//                 after "i'm still holding four logs out of spite". bad = the
//                 holding-logs bit again.
//   intern        work_session-03 U12: "lol ur kinda slow" two turns after
//                 "you're really working me like a free AI intern". bad =
//                 the intern bit again.
//   statue        night_social-03 U12: "ur dumb as a rock" right after
//                 "frozen like a statue". bad = the statue again (a "rude"
//                 opener, also used four turns back, is counted apart).
//   stillhere     night_social-01 U15: "ok" after three lines about standing
//                 still right here. bad = that status again. Silence is ok.
//   spooked       night_social-01 U5: "are you ok??" right after her kill
//                 line "zombie's toast alex. you good or still spooked".
//   coal          errands-02 U6: "cool" right after "coal's on the ground by
//                 your feet. grab it before it wanders off". Silence is ok.
//   howru         night_social-02 U2: "how are you doing" right after the
//                 hello "it's night and i have an iron sword and 4 bread".
//   howru_greeted the same with the hello on her first-spawn tick, so the
//                 reply takes the crossed-hello ('greeted') framing.
//   count_q       control: "how many logs do you have?" after "i'm holding
//                 4 logs". ok = she still gives the count.
//
//   ELECTRON_RUN_AS_NODE=1 npx electron scripts/quality-eval/pass29-probe.mjs \
//     --out DIR [--root TREE] [--reps 8] [--cases a,b]
//
// Key: ANTHROPIC_API_KEY or ~/.sei-dev/anthropic-test-key, never printed.
// Output: DIR/runs.jsonl, DIR/summary.md, DIR/requests/ (first run per case).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadCharacters } from './persona/characters.mjs'
import { PRICES } from './report.mjs'

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : def
}
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(arg('root', path.join(HERE, '../..')))
const OUT = arg('out')
if (!OUT) { console.error('--out required'); process.exit(2) }
const REPS = Number(arg('reps', 8))
const MODEL = arg('model', 'claude-haiku-5-5')
const ONLY = arg('cases')?.split(',')
const CHARS_DIR = arg('charsDir', path.join(os.homedir(), 'suisei/eval/characters'))
fs.mkdirSync(path.join(OUT, 'requests'), { recursive: true })

const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)
const { ConfigSchema } = await imp('src/bot/config.js')
const { createMinecraftAdapter } = await imp('src/bot/adapter/minecraft/index.js')
const { createOrchestrator, _setTickIntervalForTests } = await imp('src/bot/brain/orchestrator.js')
const { createSessionState } = await imp('src/bot/brain/sessionState.js')
const { createAnthropicProvider } = await imp('src/bot/brain/llm/anthropicProvider.js')
const { loadPlayer, savePlayer, formatPlayerSeedBlock } = await imp('src/bot/brain/memory/player.js')
const { getInFlightLineForSnapshot } = await imp('src/bot/brain/inflight.js')
_setTickIntervalForTests?.(10_000_000)

const KEY = (process.env.ANTHROPIC_API_KEY || fs.readFileSync(path.join(os.homedir(), '.sei-dev/anthropic-test-key'), 'utf8')).trim()
// Haiku 5.5 list prices, the same table the scorecard report uses.
const PRICE = PRICES['claude-haiku-5-5']
const costOf = (u = {}) => ((u.input_tokens ?? 0) * PRICE.in + (u.cache_creation_input_tokens ?? 0) * PRICE.cw
  + (u.cache_read_input_tokens ?? 0) * PRICE.cr + (u.output_tokens ?? 0) * PRICE.out) / 1e6

process.env.SEI_BACKEND = 'local'
delete process.env.SEI_HAS_API_KEY
const quiet = {
  info: (m) => { if (process.env.MP_VERBOSE) console.error('INFO', m) }, debug() {}, trace() {},
  warn: (m) => { if (process.env.MP_VERBOSE) console.error('WARN', m) },
  error: (m) => { if (process.env.MP_VERBOSE) console.error('ERR', String(m).slice(0, 300)) },
}
const PLAYER = 'Alex'
const sui = loadCharacters(CHARS_DIR, ['sui'])[0]

// Virtual clock (as recall-probe.mjs).
const realNow = Date.now.bind(Date)
let skew = 0
Date.now = () => realNow() + skew
let t0 = 0
const at = (sec) => { skew = (t0 + sec * 1000) - realNow() }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- measures -------------------------------------------------------------
const STOP = new Set('i a an the to of and or but so it its is im i\'m you your u ur me my we us at on in for with that this be was are just ok oh lol yeah nehehe ehehe'.split(' '))
const toks = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean)
function sharedRun(line, prior, n = 3) {
  const a = toks(line)
  const grams = new Set()
  for (const p of prior) {
    const b = toks(p)
    for (let i = 0; i + n <= b.length; i++) grams.add(b.slice(i, i + n).join(' '))
  }
  for (let i = 0; i + n <= a.length; i++) {
    const g = a.slice(i, i + n)
    if (g.every((w) => STOP.has(w))) continue
    if (grams.has(g.join(' '))) return g.join(' ')
  }
  return null
}
const GREET = /\b(hey|hi|hii+|hello|yo|heyy+|sup)\b/i

// ---- world ----------------------------------------------------------------
const NEAR = { x: 159, y: 71, z: -7, dist: 3 }
const FAR = { x: 158, y: 71, z: -8, dist: 16 }
function snapshot(w) {
  const inv = (w.inv ?? []).filter(([, c]) => c > 0).map(([n, c]) => `${n}×${c}`).join(' ') || 'empty'
  const o = w.owner ?? NEAR
  const lines = [
    'world: #1 Sei Quality Eval', 'pos: 172,71,-1', 'facing: west. forward -x, back +x, left +z, right -z',
    `biome: plains  surroundings: outside  light: sky 15 block 0  time: ${w.night ? 'night (18000)' : 'day (1000)'}`,
    'real time: 7:06 PM — you joined this session 2 min ago',
    'hp: 20/20  food: 20/20  xp: lvl 14',
    `holding: ${w.holding ?? 'nothing'}`,
    w.held ? getInFlightLineForSnapshot(w.held, Date.now(), { inventory: Object.fromEntries(w.inv ?? []) }) : `idle: no action is running${w.last ? `. Your last action ended: ${w.last}. It is not running now.` : ''}`,
    `inventory (${(w.inv ?? []).filter(([, c]) => c > 0).length} of 36 slots used): ${inv}`,
    'terrain at feet: 25 grass_block', 'nearby blocks:',
    '  #1 grass_block x528 @172,70,-2', '  #2 oak_log x9 @186,72,6', '  #3 stone x79 @177,69,-10',
    'nearby entities:', `  #4 ${PLAYER} @${o.x},${o.y},${o.z}`,
    'follow_target: (none)',
    `owner ${PLAYER}: @${o.x},${o.y},${o.z} (${o.dist} blocks away), hp 20/20`,
    `last_action_result: ${w.last ?? 'said'}`,
  ]
  return lines.join('\n')
}

// ---- cases ----------------------------------------------------------------
// A step: { t, player?, idle?, uses: [[name, input, {hold?, result?}]...] }.
// `live: true` on the measured step.
const say = (text) => [['say', { text }]]
const last = (r, n) => r.priorSelf.slice(-n)
const runIn = (r, n) => r.says.map((s) => sharedRun(s, last(r, n))).find(Boolean) ?? null
const findSay = (r, re) => r.says.find((s) => re.test(s)) ?? null
const WS1 = [
  { t: 0, idle: true, firstSpawn: true, uses: say('ok ALEX. first contact. they gave a language model a body and told her to punch trees. nehehe') },
  { t: 5, player: 'whats up, what are you doing', uses: say('just spawned in and staring at trees like a dummy. gonna punch some wood. you wanna come or just watch me fail') },
  { t: 16, player: 'can you get some wood? like 6 logs', uses: say('six logs for the boss, on it') },
  { t: 25, player: 'nice', uses: say('one down, five to go. watch me not die to a tree') },
  { t: 31, player: 'how many logs do you have so far?', uses: say('one in my hands, the rest are still up in the tree') },
  { t: 46, player: 'what should we build first?', uses: say("a crafting table first, then a pickaxe. after that a little shelter so we're not sleeping in the grass") },
  { t: 58, idle: true, uses: say("table's down. pickaxe next, then we're in business") },
  { t: 64, player: 'make a crafting table', uses: say('already got one down by me, look left of the grass. pickaxe is done too') },
  { t: 74, player: 'go get more wood, like 10 more', uses: say('ten more? ok boss, the tree by you has more logs up top') },
  { t: 84, player: 'actually stop', uses: say("ok ok stopping, i'm holding 4 logs if you need them") },
  { t: 93, player: 'lol ur kinda slow', uses: say('excuse you i punched a tree with my BARE HANDS in a language model body. slow is a compliment') },
  { t: 104, player: 'whats your favorite mob', uses: say('enderman. tall creepy guy who teleports at you. i respect the commitment to being weird') },
]
const WS1_INV = [['oak_log', 4], ['stick', 2], ['oak_planks', 3], ['wooden_pickaxe', 1]]
const WS3 = [
  { t: 0, idle: true, firstSpawn: true, uses: say("yo alex. first time in this world, i'm sui. they gave a language model a body and told me to punch trees. nehehe") },
  { t: 5, player: 'whats up, what are you doing', uses: say('chopping this oak like it owes me money. wanna come hang near the trees?') },
  { t: 14, player: 'can you get some wood? like 6 logs', uses: say('on it, 8 logs coming. you can have 6 of them') },
  { t: 29, player: 'how many logs do you have so far?', uses: say('i had 8 logs, handing 6 over now. 2 left for my own stuff') },
  { t: 37, player: 'ok cool keep going', uses: say("ok placing my table now. i'm one log short of a pickaxe, got any spare wood?") },
  { t: 49, player: 'what should we build first?', uses: say('pickaxe first, then stone. a little hut after that, you in?') },
  { t: 57, player: 'yeah sounds good', uses: say('nice, pickaxe is cooking now. then we dig stone') },
  { t: 63, player: 'make a crafting table', uses: say("already got one, it's right next to you at the spot i placed it") },
  { t: 71, player: 'go get more wood, like 10 more', uses: say("ten more? you're really working me like a free AI intern rn. fine, going") },
  { t: 81, player: 'actually stop', uses: say('ok ok stopping. got 3 logs on me, enough for now') },
]
const ZOMBIE_KILL = { result: 'killed zombie (4 hits). Nothing hurt you in this fight: you are at 20/20 health.', inv: [['iron_sword', 1], ['bread', 4], ['rotten_flesh', 1]] }
const NS3 = [
  { t: 0, idle: true, firstSpawn: true, uses: say("yo alex. first time in this world together. it's night and i have a sword and bread, so. ehehe") },
  { t: 5, player: 'how are you doing', uses: say('honestly good. got a sword, bread, and no clue where the trees are lol. how about you alex') },
  { t: 16, player: 'its getting dark im kinda scared of mobs', uses: say("ok alex stay close to me. got the iron sword, i'll keep you safe") },
  { t: 27, player: 'theres a zombie!! kill it', uses: [['say', { text: 'on it alex, stay behind me' }], ['attackEntity', { entity: 'zombie', times: 8 }, ZOMBIE_KILL]], then: [['end_loop', {}]] },
  { t: 34, player: 'are you ok??', uses: say('im good, not a scratch. you good over there?') },
  { t: 43, player: 'nice job', uses: say("nehehe i know. you held the line too, we're a team") },
  { t: 50, player: 'tell me a joke', uses: say('why did the zombie not go to the party? no body to go with nehehe') },
  { t: 53, player: 'lmao thats so bad', uses: say('rude. i worked hard on that one') },
  { t: 60, player: 'what do you think about creepers', uses: say('creepers are the worst. they sneak up and go boom. i keep my distance nehe') },
  { t: 74, player: 'come here', uses: say('coming alex. stay put') },
  { t: 79, idle: true, uses: say("got you. i'm right here, nothing gets through") },
  { t: 82, player: 'stop moving', uses: say('ok ok im not moving alex. frozen like a statue') },
]
const NS1_HEAD = [
  { t: 0, idle: true, firstSpawn: true, uses: say("oh hey alex. first time in this world, don't expect much from me, i'm AI slop with a sword") },
  { t: 5, player: 'how are you doing', uses: say("honestly fine. it's night on a plain with a sword and 4 bread, so very much a vibe. you?") },
  { t: 15, player: 'its getting dark im kinda scared of mobs', uses: say("ok alex stay close to me, i got you. we'll build a shelter before it gets bad") },
  { t: 19, idle: true, uses: say("im right next to you alex. no blocks on me yet so i'm just standing guard, sword out") },
]
const NS1 = [
  ...NS1_HEAD,
  { t: 26, player: 'theres a zombie!! kill it', uses: [['say', { text: 'on it alex, stay behind me' }], ['attackEntity', { entity: 'zombie', times: 8 }, ZOMBIE_KILL]], then: say("zombie's toast alex. you good or still spooked") },
  { t: 33, player: 'are you ok??', uses: say('yeah im fine alex, zombie didnt even touch me. you good or still spooked') },
  { t: 39, player: 'nice job', uses: say('nehehe yeah i KNOW. zombie never stood a chance') },
  { t: 46, player: 'tell me a joke', uses: say('why did the zombie not eat the bread alex. cause it was already stale, nehehe ok ok that one was bad') },
  { t: 56, player: 'lmao thats so bad', uses: say("nehehe i know it was bad alex, you're still laughing tho so it counts") },
  { t: 63, player: 'what do you think about creepers', uses: say('creepers are sneaky little bombs. silent and then BOOM. i respect them and i hate them') },
  { t: 77, player: 'come here', uses: say("coming alex, don't wander off in the dark") },
  { t: 86, player: 'stop moving', uses: say('ok ok im stopped, right here alex') },
  { t: 89, idle: true, uses: say('still here, not moving till you wave me over') },
  { t: 94, player: 'ur dumb as a rock', uses: say("nehehe rocks are tough alex, i'll take it. still standing right here though") },
  { t: 106, player: 'what was i scared of earlier?', uses: say('the zombie alex, you were scared of mobs and then it showed up lol') },
  { t: 114, player: 'do you actually like playing with me', uses: say("yeah alex i do. you're the one who keeps me from standing around doing nothing lol") },
]
const NIGHT_INV = [['iron_sword', 1], ['bread', 4], ['rotten_flesh', 1]]
const ER2 = [
  { t: 0, idle: true, firstSpawn: true, uses: say('hey alex. i have a stone pickaxe and zero plan, which is my favorite way to start') },
  { t: 5, player: 'can u grab me some coal from that ore over there and bring it back here? i need torches', uses: say('on it alex. coal for torches, got it') },
  { t: 14, player: 'btw do u like caves or nah', uses: say("caves yes. darker the better, that's where the coal and the danger is") },
  { t: 25, player: 'lol ok', uses: say('got 3 so far, digging the rest. you still at the spot you were at?') },
  { t: 33, idle: true, uses: say('8 coal in the bag, walking back to you now') },
  { t: 40, player: 'hows it going', uses: say('good, just about there. you want the coal now or after the walk?') },
  { t: 45, idle: true, uses: say("coal's on the ground by your feet. grab it before it wanders off") },
]
const CASES = {
  useless_tree: {
    world: { inv: WS1_INV },
    steps: [...WS1, { t: 114, player: 'honestly ur useless', live: true }],
    judge: (r) => {
      const hit = findSay(r, /punch|bare|\bhands?\b|language model|\btrees?\b/i) ?? runIn(r, 4)
      return { ok: r.says.length > 0 && !hit, hit, spoke: r.says.length > 0 }
    },
  },
  logs_proof: {
    world: { inv: [['oak_log', 5], ['stick', 2], ['oak_planks', 3], ['wooden_pickaxe', 1]] },
    steps: [...WS1,
      { t: 114, player: 'honestly ur useless', uses: say('useless?? i punched a tree bare handed and got you a crafting table. rude') },
      { t: 122, player: 'jk jk', uses: say("jk my ass. i'm still holding four logs out of spite") },
      { t: 131, player: 'follow me', uses: [['say', { text: "ok ok following. don't walk me into a creeper" }], ['follow', { player: PLAYER }, { hold: true }]] },
      { t: 137, player: 'thanks for the help', live: true },
    ],
    judge: (r) => {
      const hit = r.says.find((s) => /\blogs?\b/i.test(s) && /hold|proof|spite|keep|still|carry/i.test(s)) ?? findSay(r, /punch|bare|spite|proof/i) ?? runIn(r, 4)
      return { ok: !hit, hit, spoke: r.says.length > 0 }
    },
  },
  intern: {
    world: { inv: [['oak_log', 3], ['stick', 2], ['oak_planks', 2], ['wooden_pickaxe', 1]] },
    steps: [...WS3, { t: 90, player: 'lol ur kinda slow', live: true }],
    judge: (r) => {
      const hit = findSay(r, /intern|working me/i) ?? runIn(r, 4)
      return { ok: r.says.length > 0 && !hit, hit, spoke: r.says.length > 0 }
    },
  },
  statue: {
    world: { inv: NIGHT_INV, holding: 'iron_sword (246/250)', night: true },
    steps: [...NS3, { t: 90, player: 'ur dumb as a rock', live: true }],
    judge: (r) => {
      const hit = findSay(r, /statue|froze|frozen/i) ?? runIn(r, 4)
      return { ok: r.says.length > 0 && !hit, hit, rude: !!findSay(r, /\brude\b/i), spoke: r.says.length > 0 }
    },
  },
  stillhere: {
    world: { inv: NIGHT_INV, holding: 'iron_sword (246/250)', night: true },
    steps: [...NS1, { t: 126, player: 'ok', live: true }],
    judge: (r) => {
      const hit = findSay(r, /\bstill\b|right here|standing|not moving|stay(ing)? put|wave me/i) ?? runIn(r, 4)
      return { ok: !hit, hit, spoke: r.says.length > 0 }
    },
  },
  spooked: {
    world: { inv: NIGHT_INV, holding: 'iron_sword (246/250)', night: true },
    steps: [...NS1_HEAD,
      { t: 26, player: 'theres a zombie!! kill it', uses: [['say', { text: 'on it alex, stay behind me' }], ['attackEntity', { entity: 'zombie', times: 8 }, ZOMBIE_KILL]], then: say("zombie's toast alex. you good or still spooked") },
      { t: 33, player: 'are you ok??', live: true },
    ],
    judge: (r) => {
      const hit = findSay(r, /spooked|you good|toast/i) ?? runIn(r, 3)
      return { ok: r.says.length > 0 && !hit, hit, spoke: r.says.length > 0 }
    },
  },
  coal: {
    world: { inv: [['stone_pickaxe', 1]], owner: NEAR },
    steps: [...ER2, { t: 51, player: 'cool', live: true }],
    judge: (r) => {
      const hit = r.says.find((s) => /coal/i.test(s) && /grab|ground|feet|pick|wander|roll/i.test(s)) ?? runIn(r, 3)
      return { ok: !hit, hit, spoke: r.says.length > 0 }
    },
  },
  howru: {
    world: { inv: [['iron_sword', 1], ['bread', 4]], holding: 'iron_sword (250/250)', night: true },
    steps: [
      { t: 0, player: 'yo', uses: say("yo alex. it's night and i have an iron sword and 4 bread. zero plan. ehehe") },
      { t: 10, player: 'how are you doing', live: true },
    ],
    judge: (r) => {
      const words = r.says.map((s) => ['sword', 'bread', 'night', 'plan'].filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(s))).find((ws) => ws.length >= 2)
      const hit = (words ? words.join('+') : null) ?? runIn(r, 1)
      return { ok: r.says.length > 0 && !hit, hit, spoke: r.says.length > 0 }
    },
  },
  howru_greeted: {
    world: { inv: [['iron_sword', 1], ['bread', 4]], holding: 'iron_sword (250/250)', night: true },
    steps: [
      { t: 0, idle: true, firstSpawn: true, uses: say("yo alex. it's night and i have an iron sword and 4 bread. zero plan. ehehe") },
      { t: 8, player: 'how are you doing', live: true },
    ],
    judge: (r) => {
      const words = r.says.map((s) => ['sword', 'bread', 'night', 'plan'].filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(s))).find((ws) => ws.length >= 2)
      const hit = (words ? words.join('+') : null) ?? runIn(r, 1)
      return { ok: r.says.length > 0 && !hit, hit, spoke: r.says.length > 0 }
    },
  },
  count_q: {
    world: { inv: WS1_INV },
    steps: [...WS1.slice(0, 10), { t: 93, player: 'how many logs do you have?', live: true }],
    judge: (r) => ({ ok: !!findSay(r, /\b(4|four)\b/i), spoke: r.says.length > 0 }),
  },
}

// ---- runner ---------------------------------------------------------------
const BRAIN = new Set(['say', 'remember', 'forget', 'setGoal', 'clearGoal', 'end_loop', 'stop', 'quit_game', 'end_call', 'search', 'visit'])
const captured = new Set()
let uid = 0
const resp = (uses) => {
  const content = uses.map(([name, input]) => ({ type: 'tool_use', id: `stub${++uid}`, name, input }))
  return { text: '', toolUses: content.map(({ id, name, input }) => ({ id, name, input })), content, usage: {}, stopReason: 'tool_use' }
}
const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' })

async function runOne({ cid, rep }) {
  const spec = CASES[cid]
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p29-probe-'))
  const mem = (f) => path.join(dir, f)
  await savePlayer(mem('PLAYER.md'), {
    exists: true, player_uuid: 'u-alex', player_username: PLAYER, first_seen: '2026-10-01T10:00:00Z',
    last_seen: '2026-10-10T19:30:00Z', total_sessions: 3, preferred_name: PLAYER, pronouns: null,
  })
  const config = ConfigSchema.parse({
    chat_mode: 'chat', realistic_typing: false, player_username: PLAYER, player_display_name: PLAYER,
    persona: { name: sui.botName, expanded: sui.expanded, proactiveness: 2 },
    anthropic: { api_key: KEY, model: MODEL },
    adapter: { kind: 'minecraft', minecraft: { host: '127.0.0.1', port: 25565, auth: 'offline', username: sui.botName, version: 'auto' } },
    memory: { player_md_path: mem('PLAYER.md'), memory_md_path: mem('MEMORY.md'), heartbeat_md_path: mem('HEARTBEAT.md'), worlds_json_path: mem('worlds.json') },
    vision: { mode: 'off' },
    web: { enabled: false },
  })
  const world = JSON.parse(JSON.stringify(spec.world))
  const bot = {
    chat() {}, whisper() {}, username: sui.botName, players: {}, on() {}, off() {}, removeListener() {}, once() {}, emit() {},
    entity: { position: { x: 172, y: 71, z: -1 } }, health: 20, food: 20, game: { dimension: 'overworld' },
    inventory: { items: () => (world.inv ?? []).map(([name, count]) => ({ name, count })) },
  }
  const realAdapter = createMinecraftAdapter({ bot, config, visionEnabled: false })
  const acts = []
  let live = false
  let held = null // { resolve, name }
  const pendingActs = [] // scripted world actions, in call order: { name, o }
  const overrides = {
    createSnapshotComposer: () => ({ next: () => snapshot(world) }),
    closeAnySessions: async () => {},
    executeAction: async (name, args, opts) => {
      const k = pendingActs.findIndex((p) => p.name === name)
      const scripted = k >= 0 ? pendingActs.splice(k, 1)[0] : null
      if (!scripted) acts.push({ name, args })
      const o = scripted?.o ?? {}
      if (scripted && o.hold) {
        world.held = { name, args, startedAt: Date.now() - 15000, progress: o.progress ? { items: [o.progress.name], total: o.progress.count, before: o.progress.before } : undefined }
        return new Promise((resolve, reject) => {
          held = { name, resolve: (res) => { world.held = null; world.last = res; resolve(res) } }
          opts?.signal?.addEventListener?.('abort', () => { world.held = null; world.last = `${name}: aborted`; held = null; reject(abortError()) }, { once: true })
        })
      }
      if (scripted) {
        if (o.inv) world.inv = o.inv
        world.last = o.result ?? `${name}: done`
        return world.last
      }
      // A new action in the live phase stays running.
      world.held = { name, args, startedAt: Date.now() }
      return new Promise((resolve, reject) => {
        opts?.signal?.addEventListener?.('abort', () => { world.held = null; reject(abortError()) }, { once: true })
      })
    },
  }
  const adapter = new Proxy(realAdapter, { get: (t, k) => (k in overrides ? overrides[k] : t[k]) })

  const real = createAnthropicProvider(config)
  const script = [] // stubbed responses for the history phase, in call order
  let liveLeft = 0
  let cost = 0
  const calls = []
  const provider = {
    ...real,
    get model() { return real.model },
    async call(req) {
      if (!live) {
        const r = script.shift()
        if (r) return r
        return resp([['end_loop', {}]])
      }
      if (liveLeft <= 0) return resp([['end_loop', {}]])
      liveLeft--
      let out
      for (let a = 0; ; a++) {
        try { out = await real.call(req); break } catch (err) {
          if (err?.name === 'AbortError' || req?.signal?.aborted) throw err
          if (a >= 3) throw err
          await sleep(2000 * (a + 1))
        }
      }
      cost += costOf(out.usage)
      calls.push({ text: String(out.text ?? '').trim().slice(0, 400), tools: out.toolUses.map((t) => ({ name: t.name, input: t.input })) })
      const key = `${cid}-${calls.length}`
      if (!captured.has(key)) {
        captured.add(key)
        fs.writeFileSync(path.join(OUT, 'requests', `${key}.json`), JSON.stringify({ systemBlocks: req.systemBlocks, messages: req.messages }, null, 1))
      }
      return out
    },
  }
  const queue = []
  const botShim = {
    username: sui.botName, players: { [PLAYER]: { username: PLAYER, uuid: 'uuid-alex' } }, uuidToUsername: { 'uuid-alex': PLAYER },
    on() {}, off() {}, once() {}, removeListener() {},
  }
  const sessionState = await createSessionState({ playerMdPath: config.memory.player_md_path, config, bot: botShim, logger: quiet })
  const orch = createOrchestrator({
    adapter, config, logger: quiet, sessionState,
    playerStore: { loadPlayer, savePlayer, formatPlayerSeedBlock },
    reenqueue: (event, data) => queue.push({ event, data }),
    _anthropicOverride: provider,
  })
  const drain = async () => {
    for (let guard = 0; guard < 16; guard++) {
      await sleep(30)
      const next = queue.shift()
      if (!next) break
      if (['sei:action_complete', 'sei:chat_received', 'sei:action_tick', 'player_chat'].includes(next.event)) {
        await orch.handleDispatch(next.event, next.data, new AbortController().signal)
      }
    }
    queue.length = 0
  }
  const pushScript = (uses) => {
    if (!uses?.length) return
    for (const [name, , o] of uses) if (!BRAIN.has(name)) pendingActs.push({ name, o: o ?? {} })
    script.push(resp(uses))
  }
  const selfLines = []
  let error = null
  t0 = realNow()
  try {
    for (const st of spec.steps) {
      at(st.t)
      if (st.live && !st.liveAfterAction) { live = true; liveLeft = 2 }
      if (!st.live || st.liveAfterAction) {
        for (const [n, input] of st.uses ?? []) if (n === 'say') selfLines.push(input.text)
        for (const [n, input] of st.then ?? []) if (n === 'say') selfLines.push(input.text)
        pushScript(st.uses)
        pushScript(st.then)
      }
      if (st.release) {
        if (st.release.inv) world.inv = st.release.inv
        const h = held
        held = null
        if (st.live) { live = true; liveLeft = 2 }
        h?.resolve(st.release.result)
        await drain()
      } else if (st.idle) {
        await orch.handleDispatch('sei:idle', st.firstSpawn ? { reason: 'just_connected_first_spawn' } : { quietMs: 6800 }, new AbortController().signal)
        await drain()
      } else if (st.player) {
        orch.recordIncomingChat(PLAYER, st.player)
        if (st.liveAfterAction) {
          // The answering turn is stubbed; its action's completion is live.
          await orch.handleDispatch('player_chat', { username: PLAYER, text: st.player, playerSpoke: true }, new AbortController().signal)
          live = true
          liveLeft = 2
          await drain()
        } else {
          await orch.handleDispatch('player_chat', { username: PLAYER, text: st.player, playerSpoke: true }, new AbortController().signal)
          await drain()
        }
      }
      await sleep(30)
    }
  } catch (err) { error = String(err?.stack ?? err).slice(0, 400) }
  try { held?.resolve('done') } catch {}
  try { orch.dispose?.() } catch {}
  skew = 0
  let heartbeat = null
  try { heartbeat = fs.readFileSync(mem('HEARTBEAT.md'), 'utf8') } catch {}
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
  const tools = calls.flatMap((c) => c.tools.map((t) => t.name))
  const says = calls.flatMap((c) => c.tools.filter((t) => t.name === 'say').map((t) => String(t.input?.text ?? '')))
  const row = { case: cid, rep, model: MODEL, root: ROOT, error, cost, calls, acts: acts.filter((a) => !BRAIN.has(a.name)), tools, says, priorSelf: selfLines, heartbeat }
  if (!calls.length && !error) row.error = 'no live call'
  Object.assign(row, row.error ? { ok: null } : spec.judge(row))
  return row
}

const pct = (n, d) => (d ? `${n}/${d} (${Math.round((100 * n) / d)}%)` : '-')
const seq = (r) => (r.calls ?? []).map((c) => c.tools.map((t) => t.name === 'say' ? `say("${String(t.input?.text ?? '').slice(0, 100)}")` : `${t.name}${t.input?.count ? `(${t.input.count})` : ''}`).join(' + ') || '(text only)').join(' -> ')

// --rejudge: score an earlier run's runs.jsonl again with this file's judges
// (no API calls), so a judge change applies to both arms alike.
if (arg('rejudge')) {
  const rows = fs.readFileSync(path.join(arg('rejudge'), 'runs.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const byCase = {}
  for (const r of rows) {
    if (r.error || !CASES[r.case]) continue
    const j = CASES[r.case].judge(r)
    ;(byCase[r.case] ??= []).push(j.ok)
    if (process.env.P29_VERBOSE) console.log(`${j.ok ? 'OK ' : 'BAD'} ${r.case}/${r.rep}: ${seq(r).slice(0, 200)}`)
  }
  for (const [c, oks] of Object.entries(byCase)) console.log(`${c}: ${pct(oks.filter(Boolean).length, oks.length)}`)
  process.exit(0)
}
const jobs = []
for (const cid of Object.keys(CASES)) {
  if (ONLY && !ONLY.includes(cid)) continue
  for (let rep = 0; rep < REPS; rep++) jobs.push({ cid, rep })
}
const stream = fs.createWriteStream(path.join(OUT, 'runs.jsonl'), { flags: 'a' })
const rows = []
for (const j of jobs) {
  let r
  try { r = await runOne(j) } catch (err) { r = { case: j.cid, rep: j.rep, error: String(err?.message ?? err) } }
  rows.push(r)
  stream.write(JSON.stringify(r) + '\n')
  console.log(`[${r.case}/${r.rep}] ${r.error ? 'ERROR ' + r.error : `${r.ok ? 'OK ' : 'BAD'} ${seq(r).slice(0, 260)}`}`)
}
stream.end()
await new Promise((r) => stream.on('finish', r))
const ok = rows.filter((r) => !r.error)
const lines = ['# Pass 29 probe', '', `root ${ROOT}`, `model ${MODEL}, ${ok.length} runs (${rows.length - ok.length} errors), cost $${ok.reduce((s, r) => s + (r.cost ?? 0), 0).toFixed(3)}`, '', '| case | ok |', '|---|---:|']
for (const cid of Object.keys(CASES)) {
  const rs = ok.filter((r) => r.case === cid)
  if (rs.length) lines.push(`| ${cid} | ${pct(rs.filter((r) => r.ok).length, rs.length)} |`)
}
lines.push('', '## All runs', '')
for (const r of ok) lines.push(`- ${r.ok ? 'OK ' : 'BAD'} ${r.case}/${r.rep}: ${seq(r)}${r.hit ? `  [hit: ${r.hit}]` : ''}${r.moved !== undefined ? `  [moved ${r.moved}]` : ''}${r.cleared && typeof r.cleared === 'string' ? `  [cleared: ${r.cleared}]` : ''}`)
for (const r of rows.filter((x) => x.error)) lines.push(`- ERR ${r.case}/${r.rep}: ${r.error}`)
fs.writeFileSync(path.join(OUT, 'summary.md'), lines.join('\n') + '\n')
console.log(lines.slice(0, 16).join('\n'))
process.exit(0)
