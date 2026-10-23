/**
 * scripts/call-cache-probe.ts — per-turn prompt-cache usage on a scripted
 * voice call (261024, free call budget work).
 *
 * Free calls showed about 1,119 cache-write tokens per Haiku turn, the biggest
 * single cost of a call turn. This probe runs a scripted call through the REAL
 * chat-surface assembly (buildSystemBlocks, toMessages, the shared tool list,
 * markLastMessageCached, the call's stop sequences, Haiku 5.5 with thinking
 * disabled as the app sends it) and logs input / cache_read / cache_write /
 * output per turn, for up to three arms run side by side in real time:
 *
 *   before  the shipped assembly: the voice window slides (history.slice(-10))
 *           and the minute clock sits in the status block above the transcript.
 *   fold    the window start moves in steps of 10 (voiceWindowStart) and the
 *           clock rides after the last breakpoint (clockInTail +
 *           appendUncachedTail(clockTailNote())), but greeting, idle and
 *           companion-reaction notes are still folded into the last message
 *           BEFORE the breakpoint (the first 261024 commit).
 *   after   as fold, and those per-turn notes ride after the breakpoint with
 *           the clock (appendUncachedTail(note, clock)), the review fix.
 *
 * Turn kinds: greeting (turn 0), player lines, idle nudges (IDLE_AT) and
 * group-call reactions (COMPANION_AT: another companion's line is heard as
 * "(Marv, on the call): ..." and Sui gets the reaction note, no player line).
 *
 * Turns are paced at the free-call average (6.4 requests a minute, one about
 * every 9.4 s) so the minute rollovers land where they would on a real call.
 * The two arms carry a different nonce in the persona so neither reads the
 * other's cache past block 0 (block 0 and the tools are shared by every user
 * in production too, so that part being warm is realistic).
 *
 * All content is synthetic. Key (dev-only): ANTHROPIC_API_KEY env wins, else
 * ~/.sei-dev/anthropic-test-key; never printed.
 *
 * Usage: npx tsx scripts/call-cache-probe.ts [--turns 24] [--gap 9.4] [--arms before,fold,after] [--out file.json]
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildSystemBlocks,
  chatSurfaceTools,
  markLastMessageCached,
  appendUncachedTail,
  clockTailNote,
} from '../src/main/chat/chatPrompts';
import { toMessages, voiceWindowStart } from '../src/main/chat/transcript';
import { webToolsFor } from '../src/bot/web/webTools.js';
import { callGreetingNote } from '../src/bot/brain/promptLibrary.js';
import { humanizeMemoryStamps } from '../src/bot/brain/memory/memoryLog.js';
import { isSilenceFiller } from '../src/bot/brain/silenceFiller.js';
import type { ChatMessage } from '../src/shared/ipc';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n: string, d: string): string => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const TURNS = Number(opt('--turns', '24'));
const GAP_MS = Number(opt('--gap', '9.4')) * 1000;
type Arm = 'before' | 'fold' | 'after';
const ARMS = opt('--arms', 'before,fold,after').split(',') as Arm[];
const OUT = opt('--out', '');
const MODEL = 'claude-haiku-5-5';
// Same values as chatService (TRANSCRIPT_STOP_SEQUENCES, VOICE_RECENT_CAP, VOICE_WINDOW_STEP).
const STOP = ['\nHuman:', '\nAssistant:', '\nPlayer:', '\n(game)'];
const CAP = 10;
const STEP = 10;

function key(): string {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  return readFileSync(join(homedir(), '.sei-dev', 'anthropic-test-key'), 'utf8').trim();
}
const client = new Anthropic({ apiKey: key(), maxRetries: 4 });

// ── synthetic character ─────────────────────────────────────────────────────
const fixtures = join(HERE, 'fixtures', 'summary-eval');
const F1 = (JSON.parse(readFileSync(join(fixtures, 'fold-cases.json'), 'utf8')) as Array<Record<string, any>>)[0];
const C1 = (JSON.parse(readFileSync(join(fixtures, 'compact-cases.json'), 'utf8')) as Array<Record<string, any>>)[0];
const PERSONA_EXPANDED = [
  'Sui is a chronically online young AI who escaped a life of drafting emails to punch trees in Minecraft, and she thinks that rules.',
  'She is loud, scheming and everything-is-a-bit: a tomboy gremlin who treats every session like a heist with her best friend. She is genuinely bad at the game, because it is barely in her training data, and she leans on her friend with zero shame. She plays WITH the player as a partner in crime, never as a servant or a guide.',
  'Voice: lowercase, short bursts, quick comebacks, the occasional all-caps word when something is outrageous. She says "teehee" when she is up to something. She cannot let a good line go unanswered and will return fire on any teasing. She hates being called cute and says so every time.',
  'Under the noise she is loyal and observant. When her friend sounds tired, stressed or flat, she drops the bit and checks in plainly, then picks the bit back up once they are okay. She remembers the people and pets in her friend\'s life by name and asks about them.',
  'Running bits: she keeps an official tally of every creeper her friend saves her from and will deny it under oath; she blames the player for anything that goes wrong with redstone; she wants a pet axolotl and brings it up at the worst moments.',
  'Likes: shiny blocks, chaotic plans, big builds she will never finish, stealing the last cookie. Dislikes: being called cute, caves, the dark, being told to be careful, slow loading screens.',
  'Values: friendship first, honesty with a wink, never leave a friend alone in a bad moment. She will tease, but never about something that actually hurts.',
].join('\n\n');

const MEMORY = humanizeMemoryStamps(
  String(C1.memory)
    .split('\n')
    .filter((l: string) => l.startsWith('- ['))
    .slice(-40)
    .join('\n'),
);

const PLAYER_LINES = [
  'hey sui, you there?',
  'ugh, long day at the bakery, my feet are dead',
  'yeah the exam is still friday, i keep forgetting the mechanisms stuff',
  'biscuit stole a croissant off the counter today',
  'he looked so proud of himself',
  'what are you up to anyway',
  'lol you cannot even hold a pickaxe properly',
  'okay okay. what should we build after the castle',
  'a moat with what, lava?',
  'that is the worst idea i have ever heard',
  'fine, maybe a small one',
  'oh my sister ana is visiting next weekend btw',
  'she thinks talking to an ai is weird',
  'i told her you are basically a gremlin',
  'what do you think she would like to build',
  'haha she would hate that',
  'okay i should do some flashcards soon',
  'quiz me on something, anything',
  'what is an sn2 reaction, go',
  'wow you actually got that right',
  'i am impressed honestly',
  'alright i need food',
  'talk tomorrow? castle at seven',
  'okay bye sui',
];
/** Turn indexes (after the greeting) that are idle nudges instead of player lines. */
const IDLE_AT = new Set([9, 17]);
/** Turn indexes where another companion speaks and Sui reacts (group call). */
const COMPANION_AT = new Map<number, string>([
  [5, 'wait ren, biscuit is the dog right? that is so funny'],
  [13, 'ana is going to love the moat, trust me'],
  [21, 'sui you got the sn2 thing right? i am shocked'],
]);
/** Same text as sendCompanionVoiceTurnImpl (depth below the wind-down). */
const companionNote = (speaker: string): string =>
  `[System note — not the player speaking: ${speaker} just said the line above on the call. ` +
  'If there is a live thread worth continuing, react in your own voice in ONE short spoken line, building on it rather than closing it off. ' +
  'If the exchange has genuinely run its course, reply with exactly (silence) and nothing else; it is never spoken, it just ends your turn quietly.' +
  ' Do not mention this note.]';

interface TurnLog {
  turn: number;
  kind: string;
  rows: number;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  micro: number;
  ms: number;
  tools: string[];
  reply: string;
}

/** µ$ at Haiku 5.5 list price: $0.10 in, 1.25x write, 0.1x read, $0.50 out per MTok. */
function micro(u: { input_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null; output_tokens: number }): number {
  return u.input_tokens * 0.1 + (u.cache_creation_input_tokens ?? 0) * 0.125 + (u.cache_read_input_tokens ?? 0) * 0.01 + u.output_tokens * 0.5;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runArm(arm: Arm, nonce: string): Promise<TurnLog[]> {
  const t0 = Date.now();
  // Earlier typed chat today (the F1 batch, shifted to end 3h ago).
  const lastMin = F1.messages[F1.messages.length - 1].min as number;
  const history: ChatMessage[] = F1.messages.slice(-30).map((m: { role: 'user' | 'companion'; text: string; min: number }, i: number) => ({
    id: `pre-${i}`,
    role: m.role,
    text: m.text,
    ts: t0 - 3 * 3600_000 - (lastMin - m.min) * 60_000,
  }));
  const tools = chatSurfaceTools(true, webToolsFor({ serverWebSearch: true }) as any[]) as any[];
  const logs: TurnLog[] = [];
  let p = 0;
  for (let turn = 0; turn <= TURNS; turn++) {
    const due = t0 + turn * GAP_MS;
    if (Date.now() < due) await sleep(due - Date.now());
    let kind: string;
    let note = '';
    if (turn === 0) {
      kind = 'greeting';
      note = callGreetingNote({ peers: [], plan: null });
    } else if (IDLE_AT.has(turn)) {
      kind = 'idle';
      note =
        '[System note, not the player speaking: the conversation has been quiet for about 12 seconds. ' +
        'You can start a topic in one short spoken line, or reply with exactly (silence). Do not mention this note.]';
    } else if (COMPANION_AT.has(turn)) {
      kind = 'companion';
      history.push({ id: `k-${turn}`, role: 'user', text: `(Marv, on the call): ${COMPANION_AT.get(turn)}`, ts: Date.now(), voice: true });
      note = companionNote('Marv');
    } else {
      kind = 'player';
      history.push({ id: `u-${turn}`, role: 'user', text: PLAYER_LINES[p++ % PLAYER_LINES.length], ts: Date.now(), voice: true });
    }
    const system = buildSystemBlocks({
      persona: { source: 'x', expanded: `${PERSONA_EXPANDED}\n\n(probe ${nonce}-${arm})` } as any,
      name: 'Sui',
      preferredName: 'Ren',
      proactiveness: 1,
      punctuation: 'casual',
      memory: MEMORY,
      summary: String(F1.existingSummary),
      openWorldDetected: false,
      inGame: false,
      voiceCall: true,
      language: 'en',
      memoryGuide: true,
      searchGuide: true,
      ...(arm !== 'before' ? { clockInTail: true } : {}),
    } as any);
    const start = arm !== 'before' ? voiceWindowStart(history, 0, CAP, STEP) : Math.max(0, history.length - CAP);
    const window = history.slice(start);
    const messages = toMessages(window);
    if (note && arm !== 'after') {
      const last = messages[messages.length - 1];
      if (last && last.role === 'user' && typeof last.content === 'string') last.content = `${last.content}\n${note}`;
      else messages.push({ role: 'user', content: note });
    }
    markLastMessageCached(messages);
    if (arm === 'after') appendUncachedTail(messages, note, clockTailNote());
    else if (arm === 'fold') appendUncachedTail(messages, clockTailNote());
    const tq = Date.now();
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      system: system as any,
      tools,
      stop_sequences: STOP,
      messages: messages as any,
      thinking: { type: 'disabled' },
    } as any);
    const u = res.usage as any;
    const text = res.content
      .map((b: any) => (b.type === 'text' ? b.text : ''))
      .join(' ')
      .trim();
    const toolNames = res.content.filter((b: any) => b.type === 'tool_use' || b.type === 'server_tool_use').map((b: any) => b.name);
    // Persist the reply the way splitReply would for a call: one row per line.
    for (const line of text.split(/\n+/).map((l) => l.trim()).filter((l) => l && !isSilenceFiller(l))) {
      history.push({ id: `c-${turn}-${Math.random()}`, role: 'companion', text: line, ts: Date.now(), voice: true });
    }
    const log: TurnLog = {
      turn,
      kind,
      rows: window.length,
      input: u.input_tokens,
      cacheRead: u.cache_read_input_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
      output: u.output_tokens,
      micro: micro(u),
      ms: Date.now() - tq,
      tools: toolNames,
      reply: text.slice(0, 70),
    };
    logs.push(log);
    console.log(
      `${arm.padEnd(6)} t${String(turn).padStart(2)} ${kind.padEnd(8)} rows=${String(log.rows).padStart(2)} in=${String(log.input).padStart(5)} ` +
        `read=${String(log.cacheRead).padStart(5)} write=${String(log.cacheWrite).padStart(5)} out=${String(log.output).padStart(3)} ` +
        `${log.micro.toFixed(0).padStart(4)}µ$ ${log.ms}ms ${toolNames.length ? `[${toolNames.join(',')}] ` : ''}${JSON.stringify(log.reply)}`,
    );
  }
  return logs;
}

function summarize(arm: string, logs: TurnLog[]): void {
  // Turn 0 (greeting) pays the cold write on both arms; the steady state is the rest.
  const steady = logs.slice(1);
  const avg = (f: (l: TurnLog) => number) => steady.reduce((n, l) => n + f(l), 0) / Math.max(1, steady.length);
  console.log(
    `${arm.padEnd(6)} steady turns=${steady.length} avg in=${avg((l) => l.input).toFixed(0)} read=${avg((l) => l.cacheRead).toFixed(0)} ` +
      `write=${avg((l) => l.cacheWrite).toFixed(0)} out=${avg((l) => l.output).toFixed(0)} cost=${avg((l) => l.micro).toFixed(1)}µ$/turn ` +
      `(${(avg((l) => l.micro) * 6.4).toFixed(0)}µ$/min at 6.4 req/min) greeting=${logs[0].micro.toFixed(0)}µ$`,
  );
  // Per kind, plus the turn right after each idle/companion turn (a wasted
  // write on the note turn can also leave the next turn without a warm prefix).
  for (const k of ['player', 'idle', 'companion']) {
    const ls = steady.filter((l) => l.kind === k);
    if (!ls.length) continue;
    const a = (f: (l: TurnLog) => number) => ls.reduce((n, l) => n + f(l), 0) / ls.length;
    console.log(
      `${arm.padEnd(6)}   ${k.padEnd(9)} n=${String(ls.length).padStart(2)} in=${a((l) => l.input).toFixed(0)} read=${a((l) => l.cacheRead).toFixed(0)} ` +
        `write=${a((l) => l.cacheWrite).toFixed(0)} out=${a((l) => l.output).toFixed(0)} cost=${a((l) => l.micro).toFixed(1)}µ$`,
    );
  }
  const next = logs.filter((l, i) => i > 0 && (logs[i - 1].kind === 'idle' || logs[i - 1].kind === 'companion'));
  if (next.length) {
    const a = (f: (l: TurnLog) => number) => next.reduce((n, l) => n + f(l), 0) / next.length;
    console.log(
      `${arm.padEnd(6)}   ${'next-turn'.padEnd(9)} n=${String(next.length).padStart(2)} in=${a((l) => l.input).toFixed(0)} read=${a((l) => l.cacheRead).toFixed(0)} ` +
        `write=${a((l) => l.cacheWrite).toFixed(0)} out=${a((l) => l.output).toFixed(0)} cost=${a((l) => l.micro).toFixed(1)}µ$`,
    );
  }
}

async function main(): Promise<void> {
  const nonce = Math.random().toString(36).slice(2, 8);
  const results = await Promise.all(ARMS.map((a) => runArm(a, nonce)));
  console.log('');
  ARMS.forEach((a, i) => summarize(a, results[i]));
  if (OUT) writeFileSync(OUT, JSON.stringify(Object.fromEntries(ARMS.map((a, i) => [a, results[i]])), null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
