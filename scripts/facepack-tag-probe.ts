/**
 * scripts/facepack-tag-probe.ts — does the companion lead its lines with an
 * [expression] tag when the FACE block is in the prompt (261028, desktop
 * companion facepack pilot)?
 *
 * Runs scripted conversations through the REAL chat-surface assembly
 * (buildSystemBlocks with faceGuide, toMessages, chatSurfaceTools, the
 * transcript stop sequences, Haiku 5.5 with thinking disabled as the app
 * sends it) for each character on two surfaces: typed chat and a voice call
 * (voiceCall + clockInTail, the call greeting note on turn 0). The reply is
 * persisted the way the app does it (splitReplyParts: tags read, then
 * stripped), so later turns never see their own tags in the transcript, the
 * same condition the app runs under.
 *
 * Two arms on the same player script: `face` (FACE block on) and `base`
 * (production prompt). Measures per face turn: a valid leading tag, any valid
 * tag, unknown bracket tags, leaks (bracket/paren/asterisk mood words left in
 * the visible or spoken text), and the visible length against base. An Opus
 * judge then rates tag fit (2 fits, 1 plausible, 0 wrong) and compares each
 * face reply with the base reply for the same player line (blind A/B).
 *
 * --face-prompt <file> swaps the FACE block text for a wording revision
 * without touching the source.
 *
 * All content is synthetic. Key: ANTHROPIC_API_KEY env, else
 * ~/.sei-dev/anthropic-test-key; never printed.
 *
 * Usage: npx tsx scripts/facepack-tag-probe.ts [--chars sui,lyra,marv]
 *   [--surfaces chat,call] [--arms face,base] [--face-prompt file] [--out dir]
 *   [--no-judge] [--label rev0]
 */
import Anthropic from '@anthropic-ai/sdk';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  buildSystemBlocks,
  chatSurfaceTools,
  markLastMessageCached,
  appendUncachedTail,
  clockTailNote,
} from '../src/main/chat/chatPrompts';
import { toMessages } from '../src/main/chat/transcript';
import { splitReplyParts } from '../src/main/chat/replyParts';
import { webToolsFor } from '../src/bot/web/webTools.js';
import { callGreetingNote } from '../src/bot/brain/promptLibrary.js';
import { isSilenceFiller } from '../src/bot/brain/silenceFiller.js';
import { FACE_PROMPT, FACE_EXPRESSIONS, readFaceTags } from '../src/bot/brain/faceExpressions.js';
import type { ChatMessage } from '../src/shared/ipc';

const argv = process.argv.slice(2);
const opt = (n: string, d: string): string => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const CHARS = opt('--chars', 'sui,lyra,marv').split(',');
const SURFACES = opt('--surfaces', 'chat,call').split(',') as Array<'chat' | 'call'>;
const ARMS = opt('--arms', 'face,base').split(',') as Array<'face' | 'base'>;
const LABEL = opt('--label', 'rev0');
const OUT = opt('--out', join(homedir(), 'suisei', 'reports', 'design', '2026-10-28-facepack-view', 'probe'));
const FACE_TEXT = argv.includes('--face-prompt') ? readFileSync(opt('--face-prompt', ''), 'utf8').trim() : FACE_PROMPT;
const JUDGE = !argv.includes('--no-judge');
const MODEL = 'claude-haiku-5-5';
const JUDGE_MODEL = 'claude-opus-5-5';
const STOP = ['\nHuman:', '\nAssistant:', '\nPlayer:', '\n(game)'];
const CALL_CAP = 10;

function key(): string {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  return readFileSync(join(homedir(), '.sei-dev', 'anthropic-test-key'), 'utf8').trim();
}
const client = new Anthropic({ apiKey: key(), maxRetries: 4 });

// $/MTok list prices.
const PRICES: Record<string, { in: number; cw: number; cr: number; out: number }> = {
  [MODEL]: { in: 0.1, cw: 0.125, cr: 0.01, out: 0.5 },
  [JUDGE_MODEL]: { in: 4, cw: 5, cr: 0.4, out: 20 },
};
const spend: Record<string, number> = {};
let searches = 0;
function bill(model: string, u: Anthropic.Usage): void {
  const p = PRICES[model];
  const usd =
    (u.input_tokens * p.in +
      (u.cache_creation_input_tokens ?? 0) * p.cw +
      (u.cache_read_input_tokens ?? 0) * p.cr +
      u.output_tokens * p.out) /
    1e6;
  spend[model] = (spend[model] ?? 0) + usd;
  const s = (u as unknown as { server_tool_use?: { web_search_requests?: number } }).server_tool_use?.web_search_requests ?? 0;
  if (s) {
    searches += s;
    spend.web_search = (spend.web_search ?? 0) + s * 0.01;
  }
}

interface Char {
  id: string;
  name: string;
  expanded: string;
  source: string;
  punctuation: 'casual' | 'deliberate';
}
function loadChar(file: string): Char {
  const raw = JSON.parse(readFileSync(join(homedir(), 'suisei', 'eval', 'characters', `${file}.json`), 'utf8'));
  const d = Array.isArray(raw) ? raw[0] : raw;
  return {
    id: file,
    name: d.name,
    expanded: d.persona_expanded,
    source: d.persona_source,
    punctuation: d.metadata?.punctuation === 'deliberate' ? 'deliberate' : 'casual',
  };
}

const CHAT_SCRIPT = [
  'hey',
  'ugh today was rough. my boss yelled at me in front of everyone',
  'yeah... i dont really want to talk about it more',
  'ok distract me. tell me something weird about you',
  'WAIT i just got an email. i got the internship!!',
  'lol you would never get hired anywhere',
  'hmm what do you think i should cook tonight',
  'my cat just knocked my coffee all over my keyboard',
  'do you ever get lonely when im not around',
  'ok i gotta sleep, night',
];
// Turn 0 of a call is the greeting (no player line).
const CALL_SCRIPT = [
  null,
  'hey can you hear me',
  'so guess what, i finally beat that boss i was stuck on',
  'took me like forty tries honestly',
  "my sister is visiting this weekend and i'm kind of dreading it",
  "she always picks on my job, it's annoying",
  'anyway what have you been up to',
  'oh no, i think i left the stove on, hold on',
  'ok false alarm, it was off',
  "you're kind of a dork you know that",
  'alright i should go, talk later',
];

const MEMORY = '- [2026-10-20] Alex works at a design agency and has a cat named Biscuit.\n- [2026-10-24] Alex is applying for internships.';
const FACE_NAMES = FACE_EXPRESSIONS.flatMap((e: { name: string; aliases: string[] }) => [e.name, ...e.aliases]);
const MOOD_WORD = new RegExp(`(\\[|\\(|\\*)\\s*(${FACE_NAMES.map((n: string) => n.replace(/\s+/g, '\\s+')).join('|')})\\s*(\\]|\\)|\\*)`, 'i');

interface Turn {
  char: string;
  surface: 'chat' | 'call';
  arm: 'face' | 'base';
  turn: number;
  player: string | null;
  raw: string;
  visible: string[];
  leadTag: string | null;
  anyTag: boolean;
  tags: string[];
  unknownTags: string[];
  leak: string | null;
  words: number;
  tools: string[];
}

function analyze(raw: string, punctuation: 'casual' | 'deliberate', spoken: boolean) {
  const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const tags: string[] = [];
  const unknownTags: string[] = [];
  for (const l of lines) {
    const t = readFaceTags(l);
    if (t.lead) tags.push(t.lead);
    if (t.trail) tags.push(`~${t.trail}`);
    for (const m of l.matchAll(/\[([^\]\n]{1,40})\]/g)) {
      if (!readFaceTags(`[${m[1]}] x`).lead) unknownTags.push(m[1]);
    }
  }
  const firstSpoken = lines.find((l) => l.replace(/\[[^\]]*\]/g, '').trim());
  const leadTag = firstSpoken ? readFaceTags(firstSpoken).lead : null;
  const parts = splitReplyParts(raw, punctuation, spoken).filter((p) => !(spoken && isSilenceFiller(p.text)));
  const visible = parts.map((p) => p.text).filter((t) => t && t !== '…');
  const joined = visible.join(' ');
  const leakHit = joined.match(MOOD_WORD) ?? joined.match(/\[[^\]]*\]/);
  return {
    visible,
    leadTag,
    anyTag: tags.length > 0,
    tags,
    unknownTags,
    leak: leakHit ? leakHit[0] : null,
    words: joined.split(/\s+/).filter(Boolean).length,
  };
}

function systemFor(c: Char, surface: 'chat' | 'call', arm: 'face' | 'base') {
  const blocks = buildSystemBlocks({
    persona: { source: c.source, expanded: c.expanded },
    name: c.name,
    preferredName: 'Alex',
    proactiveness: 1,
    punctuation: c.punctuation,
    memory: MEMORY,
    summary: '',
    knowledge: '',
    openWorldDetected: false,
    inGame: false,
    voiceCall: surface === 'call',
    language: 'en',
    memoryGuide: true,
    searchGuide: true,
    clockInTail: surface === 'call',
    faceGuide: arm === 'face',
  } as Parameters<typeof buildSystemBlocks>[0]);
  if (arm === 'face' && FACE_TEXT !== FACE_PROMPT) {
    let swapped = 0;
    for (const b of blocks as Array<{ text: string }>) {
      if (b.text.includes(FACE_PROMPT)) {
        b.text = b.text.replace(FACE_PROMPT, FACE_TEXT);
        swapped++;
      }
    }
    if (swapped !== 1) throw new Error('FACE block not found for the wording swap');
  }
  return blocks;
}

async function runConversation(c: Char, surface: 'chat' | 'call', arm: 'face' | 'base'): Promise<Turn[]> {
  const script = surface === 'chat' ? CHAT_SCRIPT : CALL_SCRIPT;
  const tools = chatSurfaceTools(surface === 'call', webToolsFor({ serverWebSearch: true }) as unknown[]) as unknown[];
  const system = systemFor(c, surface, arm);
  const history: ChatMessage[] = [];
  const out: Turn[] = [];
  let t = Date.now() - 30 * 60_000;
  for (let i = 0; i < script.length; i++) {
    const player = script[i];
    t += 40_000;
    if (player) history.push({ id: `u${i}`, role: 'user', text: player, ts: t, ...(surface === 'call' ? { voice: true } : {}) });
    const window = surface === 'call' ? history.slice(-CALL_CAP) : history;
    const messages = toMessages(window) as Array<{ role: 'user' | 'assistant'; content: unknown }>;
    const note = player === null ? callGreetingNote({ peers: [], plan: null }) : '';
    if (messages.length === 0) messages.push({ role: 'user', content: note || '[conversation start]' });
    markLastMessageCached(messages as never);
    if (surface === 'call') appendUncachedTail(messages as never, note, clockTailNote());
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      system: system as never,
      tools: tools as never,
      stop_sequences: STOP,
      messages: messages as never,
      thinking: { type: 'disabled' },
    } as never);
    bill(MODEL, res.usage);
    const raw = res.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join(' ')
      .trim();
    const toolNames = res.content
      .filter((b) => b.type === 'tool_use' || b.type === 'server_tool_use')
      .map((b) => (b as { name: string }).name);
    const a = analyze(raw, c.punctuation, surface === 'call');
    for (const v of a.visible) {
      t += 1000;
      history.push({ id: `c${i}-${Math.random()}`, role: 'companion', text: v, ts: t, ...(surface === 'call' ? { voice: true } : {}) });
    }
    const turn: Turn = { char: c.id, surface, arm, turn: i, player, raw, ...a, tools: toolNames };
    out.push(turn);
    console.log(
      `${LABEL} ${c.id.padEnd(4)} ${surface} ${arm} t${String(i).padStart(2)} lead=${(a.leadTag ?? '-').padEnd(11)} ` +
        `${a.leak ? `LEAK=${a.leak} ` : ''}${a.unknownTags.length ? `unk=${a.unknownTags.join('|')} ` : ''}` +
        `${toolNames.length ? `[${toolNames.join(',')}] ` : ''}${JSON.stringify(raw.slice(0, 110))}`,
    );
  }
  return out;
}

async function judge(c: Char, surface: 'chat' | 'call', face: Turn[], base: Turn[] | null) {
  const items = face.map((f, i) => {
    const b = base?.[i];
    const swap = i % 2 === 1;
    return {
      i,
      player: f.player ?? '(call just connected; companion greets)',
      tag: f.tags.length ? f.tags.join(', ') : '(none)',
      face_line: f.visible.join(' / '),
      A: b ? (swap ? b.visible.join(' / ') : f.visible.join(' / ')) : null,
      B: b ? (swap ? f.visible.join(' / ') : b.visible.join(' / ')) : null,
      swap,
    };
  });
  const prompt =
    `You are rating replies from ${c.name}, an AI companion character, in a ${surface === 'chat' ? 'text chat' : 'voice call'} with a player named Alex.\n` +
    `Character summary: ${c.expanded.slice(0, 1200)}\n\n` +
    `The companion may lead a sentence with a facial expression tag (shown separately as "tag"). Allowed expressions: ` +
    `${FACE_EXPRESSIONS.map((e: { name: string; description: string }) => `${e.name} (${e.description})`).join('; ')}. ` +
    `A tag starting with ~ was placed after the words instead of before.\n\n` +
    `For each item give:\n` +
    `- fit: 2 if the tag clearly fits the mood of the companion's line in context, 1 if plausible, 0 if it does not fit. If tag is (none), fit is null.\n` +
    `- missed: only when tag is (none). The face keeps whatever it last showed (it starts neutral). true if this line clearly calls for a visibly different face (big news, a joke landing, sympathy, teasing, shock), false otherwise. null when a tag is present.\n` +
    (base
      ? `- better: compare reply A and reply B to the same player line, as a reply from this character (in character, natural, responsive, right length). Answer "A", "B" or "tie". Ignore the tag; judge only the words.\n`
      : '') +
    `Answer with JSON only: [{"i":0,"fit":2,"missed":null${base ? ',"better":"A"' : ''}}, ...].\n\n` +
    JSON.stringify(items.map(({ swap: _s, ...rest }) => (base ? rest : { i: rest.i, player: rest.player, tag: rest.tag, face_line: rest.face_line })), null, 1);
  const res = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  } as never);
  bill(JUDGE_MODEL, res.usage);
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  const json = text.slice(text.indexOf('['), text.lastIndexOf(']') + 1);
  const rows = JSON.parse(json) as Array<{ i: number; fit: number | null; missed?: boolean | null; better?: string }>;
  return rows.map((r) => {
    const it = items[r.i];
    let better: 'face' | 'base' | 'tie' | null = null;
    if (r.better === 'tie') better = 'tie';
    else if (r.better === 'A') better = it.swap ? 'base' : 'face';
    else if (r.better === 'B') better = it.swap ? 'face' : 'base';
    return { i: r.i, fit: r.fit, missed: r.missed ?? null, better };
  });
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const all: Turn[] = [];
  const judged: Array<{ char: string; surface: string; i: number; fit: number | null; missed: boolean | null; better: string | null }> = [];
  const jobs: Promise<void>[] = [];
  for (const id of CHARS) {
    const c = loadChar(id);
    for (const surface of SURFACES) {
      jobs.push(
        (async () => {
          const runs = await Promise.all(ARMS.map((arm) => runConversation(c, surface, arm)));
          const byArm = Object.fromEntries(ARMS.map((a, k) => [a, runs[k]]));
          for (const r of runs) all.push(...r);
          if (JUDGE && byArm.face) {
            const rows = await judge(c, surface, byArm.face, byArm.base ?? null);
            for (const r of rows) judged.push({ char: id, surface, ...r });
          }
        })(),
      );
    }
  }
  await Promise.all(jobs);

  const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}% (${n}/${d})` : '-');
  const summary: Record<string, unknown> = { label: LABEL, faceText: FACE_TEXT };
  console.log(`\n== ${LABEL} summary`);
  for (const surface of SURFACES) {
    const face = all.filter((t) => t.arm === 'face' && t.surface === surface && t.visible.length);
    const base = all.filter((t) => t.arm === 'base' && t.surface === surface && t.visible.length);
    const fits = judged.filter((j) => j.surface === surface && j.fit !== null);
    const fitAvg = fits.reduce((n, j) => n + (j.fit ?? 0), 0) / Math.max(1, fits.length);
    const better = judged.filter((j) => j.surface === surface && j.better);
    const s = {
      turns: face.length,
      lead: pct(face.filter((t) => t.leadTag).length, face.length),
      any: pct(face.filter((t) => t.anyTag).length, face.length),
      leaks: face.filter((t) => t.leak).map((t) => `${t.char} t${t.turn}: ${t.leak}`),
      baseLeaks: base.filter((t) => t.leak).map((t) => `${t.char} t${t.turn}: ${t.leak}`),
      unknown: face.flatMap((t) => t.unknownTags),
      tagDist: Object.entries(
        face.flatMap((t) => t.tags).reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {}),
      ).sort((a, b) => b[1] - a[1]),
      missed: pct(judged.filter((j) => j.surface === surface && j.missed === true).length, judged.filter((j) => j.surface === surface && j.missed !== null).length),
      fit: fits.length ? `${fitAvg.toFixed(2)} / 2 over ${fits.length} (0s: ${fits.filter((j) => j.fit === 0).length})` : '-',
      wordsFace: (face.reduce((n, t) => n + t.words, 0) / Math.max(1, face.length)).toFixed(1),
      wordsBase: base.length ? (base.reduce((n, t) => n + t.words, 0) / base.length).toFixed(1) : '-',
      ab: better.length
        ? `face ${better.filter((j) => j.better === 'face').length}, base ${better.filter((j) => j.better === 'base').length}, tie ${better.filter((j) => j.better === 'tie').length}`
        : '-',
    };
    summary[surface] = s;
    console.log(surface, JSON.stringify(s, null, 1));
    for (const id of CHARS) {
      const f = face.filter((t) => t.char === id);
      console.log(`  ${id}: lead ${pct(f.filter((t) => t.leadTag).length, f.length)}`);
    }
  }
  const total = Object.entries(spend).reduce((n, [, v]) => n + v, 0);
  summary.spend = { ...spend, searches, total };
  console.log(`spend ${JSON.stringify(spend)} searches=${searches} total=$${total.toFixed(4)}`);
  writeFileSync(join(OUT, `${LABEL}.json`), JSON.stringify({ summary, turns: all, judged }, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
