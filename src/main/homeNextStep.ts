/**
 * The Home "up next" card (261013, retention O2 / T119).
 *
 * 43 of 56 users active on day 0 were not back on day 1, and there is no
 * outside recall channel (no email, no OS notification, by decision). So the
 * one lever is the app itself: someone who reopens it should see a concrete
 * reason to keep going. T80 / T96 already save a "Plan for next time" entry
 * to the character's MEMORY.md at the end of a session; this module reads it
 * back for the Home screen.
 *
 * Rules (pure, unit-tested in homeNextStep.test.ts):
 *   - The plan is the NEWEST `Plan for next time:` entry in MEMORY.md. Older
 *     ones were superseded by it, so an expired or consumed newest plan means
 *     no plan, never a fall back to an older one.
 *   - It expires after NEXT_STEP_MAX_AGE_MS (7 days).
 *   - It is consumed once a later session's greeting has seen it: a game
 *     session going online or a voice call greeting (both greetings are told
 *     about the plan, NEXT_TIME_GREETING). Nothing in T80 marked a plan as
 *     used, and MEMORY.md is model-facing, so the mark lives in a small
 *     sidecar, NEXT_STEP.json in the memory dir, as a watermark
 *     (`consumedAt`): a plan written at or before it is used up. Starting a
 *     session from the card is the same event, so it needs no extra mark.
 *   - No usable plan: the newest active goal from the HEARTBEAT goal files
 *     (one per game), also within 7 days. Goals are not consumed; they stay
 *     until the companion clears them.
 *   - Nothing: no entry at all, so the renderer shows no card.
 *
 * Where a plan came from (game + which game, call, backseat) is not in the
 * MEMORY.md line. Main tags it in the same sidecar right after the plan is
 * written (tagLatestPlan: session close for a companion quit, call end for a
 * companion hang-up, the player-end check's save), keyed by the plan's
 * normalized text. A plan with no tag (written before this shipped, or
 * reworded by compaction) has surface null and the card opens the games
 * picker instead of guessing.
 *
 * Never throws to callers that ask for a card: a missing or broken file is
 * "nothing to show".
 */
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { HomeNextStep, HomeNextStepSurface } from '../shared/homeNextStep';
import { GAME_IDS } from '../shared/gameIpc';
import { nextStepMemoryLine } from '../bot/brain/nextStep.js';
import { atomicWrite } from '../bot/brain/storage/atomicWrite.js';
import { withFileLock } from '../bot/brain/storage/fileLock.js';
import { goalsFileFor } from './playerEndNextStep';

/** A plan or goal older than this is not shown. */
export const NEXT_STEP_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
/** tagLatestPlan only tags a plan written this recently. */
export const TAG_WINDOW_MS = 10 * 60_000;
/** The sidecar keeps this many tags (newest last). */
const MAX_TAGS = 20;
export const LEDGER_FILE = 'NEXT_STEP.json';

/** "Plan for next time: " (nextStep.js owns the wording). */
const PLAN_PREFIX = nextStepMemoryLine('');
const PLAN_PREFIX_RE = new RegExp(`^${PLAN_PREFIX.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i');

export interface NextStepTag {
  /** planKey() of the plan text. */
  key: string;
  /** The entry's stamp, ISO. */
  at: string;
  surface: HomeNextStepSurface;
  game?: string;
}

export interface NextStepLedger {
  v: 1;
  tags: NextStepTag[];
  /** Plans written at or before this (ISO) were seen by a later greeting. */
  consumedAt?: string;
}

export interface StampedEntry {
  at: number;
  text: string;
}

// ── pure ──────────────────────────────────────────────────────────────────

/** Loose key for matching a plan's text: lowercase letters, digits, spaces. */
export function planKey(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every `- [stamp] text` entry with a parseable stamp, in file order. */
export function stampedEntries(body: string): StampedEntry[] {
  const out: StampedEntry[] = [];
  for (const line of String(body ?? '').split('\n')) {
    const m = /^- \[([^\]]+)\]\s*(.*)$/.exec(line);
    if (!m) continue;
    const at = Date.parse(m[1]);
    const text = m[2].trim();
    if (!Number.isFinite(at) || !text) continue;
    out.push({ at, text });
  }
  return out;
}

/** The plan entries of a MEMORY.md body, prefix removed, in file order. */
export function planEntries(memory: string): StampedEntry[] {
  return stampedEntries(memory)
    .filter((e) => PLAN_PREFIX_RE.test(e.text))
    .map((e) => ({ at: e.at, text: e.text.replace(PLAN_PREFIX_RE, '').trim() }))
    .filter((e) => e.text.length > 0);
}

/** The newest entry by stamp (the later one wins a tie). */
function newest(entries: StampedEntry[]): StampedEntry | null {
  let best: StampedEntry | null = null;
  for (const e of entries) if (!best || e.at >= best.at) best = e;
  return best;
}

function capitalize(s: string): string {
  return s.length > 0 && /[a-z]/.test(s[0]) ? s[0].toUpperCase() + s.slice(1) : s;
}

/** A plan as card text: one line, no trailing period, first letter up. */
export function planDisplayText(text: string): string {
  return capitalize(String(text ?? '').replace(/\s+/g, ' ').trim().replace(/[.。]+$/, '').trim());
}

const FINISH_CUE = /\b(?:finish(?:ed)?|done|complete(?:d)?|success)\s*(?:when|once|if|after|:|=)/i;

/**
 * A goal as card text. Goals are the companion's working notes ("Get iron
 * tools with Alex: gather wood, make a wooden pickaxe. Finish when an iron
 * pickaxe exists."), so keep the headline: drop the finish condition, keep
 * the first sentence, and keep only the part before a colon when the goal is
 * written as "headline: steps". Empty when nothing readable is left.
 */
export function goalDisplayText(text: string): string {
  let s = String(text ?? '').replace(/\s+/g, ' ').trim();
  const fc = FINISH_CUE.exec(s);
  if (fc && fc.index > 0) s = s.slice(0, fc.index);
  s = s.split(/(?<=[.!?;])\s+/)[0] ?? '';
  const colon = s.indexOf(':');
  if (colon >= 8) s = s.slice(0, colon);
  s = s.replace(/[\s.,;:!?-]+$/, '').trim();
  return capitalize(s);
}

export interface PickInput {
  characterId: string;
  /** MEMORY.md body ('' when missing). */
  memory: string;
  ledger: NextStepLedger;
  /** Goal file bodies by game id. */
  goals: Array<{ game: string; body: string }>;
  now: number;
}

/** The card for one character, or null when there is nothing to show. */
export function pickNextStep(p: PickInput): HomeNextStep | null {
  const fresh = (at: number) => p.now - at <= NEXT_STEP_MAX_AGE_MS;
  const plan = newest(planEntries(p.memory));
  const consumedAt = p.ledger.consumedAt ? Date.parse(p.ledger.consumedAt) : NaN;
  if (plan && fresh(plan.at) && !(Number.isFinite(consumedAt) && plan.at <= consumedAt)) {
    const text = planDisplayText(plan.text);
    if (text) {
      const key = planKey(plan.text);
      let tag: NextStepTag | undefined;
      for (const t of p.ledger.tags) if (t.key === key) tag = t; // newest tag wins
      return {
        characterId: p.characterId,
        source: 'plan',
        text,
        at: plan.at,
        surface: tag?.surface ?? null,
        game: tag?.game ?? null,
      };
    }
  }
  let goal: { at: number; text: string; game: string } | null = null;
  for (const g of p.goals) {
    for (const e of stampedEntries(g.body)) {
      if (!fresh(e.at)) continue;
      const text = goalDisplayText(e.text);
      if (!text) continue;
      if (!goal || e.at >= goal.at) goal = { at: e.at, text, game: g.game };
    }
  }
  if (!goal) return null;
  return { characterId: p.characterId, source: 'goal', text: goal.text, at: goal.at, surface: 'game', game: goal.game };
}

/** A sidecar body as a ledger; anything unreadable is an empty one. */
export function parseLedger(raw: string | null): NextStepLedger {
  const empty: NextStepLedger = { v: 1, tags: [] };
  if (!raw) return empty;
  try {
    const j = JSON.parse(raw) as Partial<NextStepLedger> | null;
    if (!j || typeof j !== 'object') return empty;
    const tags = Array.isArray(j.tags)
      ? j.tags.filter(
          (t): t is NextStepTag =>
            !!t &&
            typeof t.key === 'string' &&
            typeof t.at === 'string' &&
            (t.surface === 'game' || t.surface === 'call' || t.surface === 'backseat') &&
            (t.game === undefined || typeof t.game === 'string'),
        )
      : [];
    const out: NextStepLedger = { v: 1, tags };
    if (typeof j.consumedAt === 'string' && Number.isFinite(Date.parse(j.consumedAt))) out.consumedAt = j.consumedAt;
    return out;
  } catch {
    return empty;
  }
}

// ── files ─────────────────────────────────────────────────────────────────

async function readOrEmpty(file: string): Promise<string> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return '';
  }
}

async function readLedger(memoryDir: string): Promise<NextStepLedger> {
  return parseLedger((await readOrEmpty(path.join(memoryDir, LEDGER_FILE))) || null);
}

/** Read-modify-write the sidecar under its lock. `fn` returns false = no write. */
async function updateLedger(memoryDir: string, fn: (l: NextStepLedger) => boolean): Promise<boolean> {
  const file = path.join(memoryDir, LEDGER_FILE);
  return withFileLock(file, async () => {
    const ledger = parseLedger((await readOrEmpty(file)) || null);
    if (!fn(ledger)) return false;
    await atomicWrite(file, JSON.stringify(ledger) + '\n');
    return true;
  });
}

/** The card for one character from its memory dir. Never throws. */
export async function readHomeNextStep(memoryDir: string, characterId: string, now = Date.now()): Promise<HomeNextStep | null> {
  try {
    const [memory, ledger, goals] = await Promise.all([
      readOrEmpty(path.join(memoryDir, 'MEMORY.md')),
      readLedger(memoryDir),
      Promise.all(GAME_IDS.map(async (game) => ({ game, body: await readOrEmpty(goalsFileFor(memoryDir, game)) }))),
    ]);
    return pickNextStep({ characterId, memory, ledger, goals, now });
  } catch {
    return null;
  }
}

/**
 * Record where the newest plan came from. Call right after a plan was
 * written (it must be at most TAG_WINDOW_MS old). Returns whether a tag was
 * written. Never throws.
 */
export async function tagLatestPlan(
  memoryDir: string,
  source: { surface: HomeNextStepSurface; game?: string | null },
  now = Date.now(),
): Promise<boolean> {
  try {
    const plan = newest(planEntries(await readOrEmpty(path.join(memoryDir, 'MEMORY.md'))));
    if (!plan || Math.abs(now - plan.at) > TAG_WINDOW_MS) return false;
    const tag: NextStepTag = {
      key: planKey(plan.text),
      at: new Date(plan.at).toISOString(),
      surface: source.surface,
      ...(source.game ? { game: source.game } : {}),
    };
    return await updateLedger(memoryDir, (l) => {
      l.tags = [...l.tags.filter((t) => t.key !== tag.key), tag].slice(-MAX_TAGS);
      return true;
    });
  } catch {
    return false;
  }
}

/**
 * A session whose greeting is told about the plan started: every plan
 * written up to now is used. Writes only when there is an unconsumed plan,
 * so most session starts touch nothing. Returns whether it wrote. Never throws.
 */
export async function consumeNextStep(memoryDir: string, now = Date.now()): Promise<boolean> {
  try {
    const plan = newest(planEntries(await readOrEmpty(path.join(memoryDir, 'MEMORY.md'))));
    if (!plan) return false;
    return await updateLedger(memoryDir, (l) => {
      const prev = l.consumedAt ? Date.parse(l.consumedAt) : NaN;
      if (Number.isFinite(prev) && plan.at <= prev) return false;
      l.consumedAt = new Date(now).toISOString();
      return true;
    });
  } catch {
    return false;
  }
}

// ── renderer notification ────────────────────────────────────────────────

let notify: ((characterId: string) => void) | null = null;

/** index.ts binds the `home:next-step-changed` push once at startup. */
export function bindHomeNextStepNotifier(fn: ((characterId: string) => void) | null): void {
  notify = fn;
}

/** Tell the renderer a character's card may have changed. */
export function noteHomeNextStepChanged(characterId: string): void {
  try {
    notify?.(characterId);
  } catch {
    /* a closed window just misses the push */
  }
}
