/**
 * The "next time" hook for sessions the PLAYER ends (261011, retention O2).
 *
 * T80 (261008, sessionGoodbye.ts + src/bot/brain/nextStep.js) lets the
 * companion's own goodbye carry a `next_time` field that is saved to MEMORY.md
 * as `Plan for next time: <step>`, and the next greeting may bring it up. But
 * most sessions are ended by the player (Stop, closing the world, hanging
 * up), and those have no goodbye turn: on the first day of 0.6.8 the hook was
 * set on 2 of 40 calls and 1 of 33 game sessions.
 *
 * So after a player-ended session with real content, main runs ONE small
 * background call on the session's own provider (cloud = Haiku through the
 * proxy, which counts against the allowance: max PLAYER_END_MAX_TOKENS out,
 * a compact input) that answers with a short plan tied to a real unfinished
 * goal or remembered thing, or `none`. A plan is saved exactly the way T80
 * saves one, so NEXT_TIME_GREETING already covers the next greeting. Nothing
 * is spoken: the player already left.
 *
 * Rules this module keeps:
 *   - It never blocks anything. Callers fire and forget; the whole run is
 *     time-boxed (PLAYER_END_TIMEOUT_MS, or the provider's own local floor for
 *     Ollama and friends, see providerTimeoutMs) and swallows every error.
 *   - It skips trivial sessions (under PLAYER_END_MIN_MS, or fewer than two
 *     player lines and no goal), offline sessions, and a cloud account over
 *     its limit (cloudOverLimit, so no credit wall is ever raised; a 402 from
 *     the call itself is swallowed too, never routed to the usage popup).
 *   - One check per character at a time, and at most one per
 *     DEDUPE_WINDOW_MS: a backseat share ends with its call, and both ends
 *     would otherwise each pay for a check.
 *   - A new session for the character aborts a check still running on a
 *     LOCAL model (Ollama), so the next session never waits behind it on the
 *     same GPU. Remote checks are left to finish: they cost the next session
 *     nothing and the plan is still useful for the one after.
 *   - Account switch: the run is a scoped turn, so a plan whose call
 *     straddles a switch is dropped instead of landing in the next account.
 *
 * Analytics: shape only, never the plan text or any transcript.
 * `next_step_checked {character_id, source:'player_end', surface, game?,
 * saved, outcome}` for every check that reached the model, plus
 * `next_step_saved {character_id, source:'player_end', surface, game?}` when a
 * plan was written. The session's `_ended` event has already fired by then
 * (it is not delayed for this), so these are follow-ups; the companion path
 * keeps `next_step_hook` and gains `next_step_source: 'companion'` on the
 * `_ended` event itself (sessionGoodbye.ts).
 */
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { LlmProvider } from './llm/types';
import { normalizeNextStep, nextStepMemoryLine, normalizePlayerLine } from '../bot/brain/nextStep.js';
import { PLAYER_END_NEXT_STEP_SYSTEM } from '../bot/brain/promptLibrary.js';
import { nameInSentence } from '../shared/homeNextStep';

export type NextStepSurface = 'game' | 'call' | 'backseat';

export interface DigestLine {
  /** The human player, this companion, or a sibling companion. */
  who: 'player' | 'you' | 'other';
  text: string;
}

export interface SessionDigest {
  lines: DigestLine[];
  /** Lines the player spoke over the whole session (not just the window). */
  playerLines: number;
  selfLines: number;
}

/** A session shorter than this is not worth a call. */
export const PLAYER_END_MIN_MS = 2 * 60_000;
/** The time box for the whole check on a remote model. */
export const PLAYER_END_TIMEOUT_MS = 15_000;
/** The plan is a few words; this caps a runaway reply. */
export const PLAYER_END_MAX_TOKENS = 150;
/** A second end for the same character inside this window is skipped. */
export const DEDUPE_WINDOW_MS = 60_000;

const MAX_LINES = 16;
const LINE_CHARS = 200;
const MAX_GOALS = 5;
const MAX_MEMORIES = 8;
const MEMORY_CHARS = 200;

/** Game end reasons that mean the player ended it. */
const PLAYER_ENDED_GAME_REASONS = new Set(['user_stop', 'world_closed', 'disconnected']);

export function isPlayerEndedGame(reason: string | undefined): boolean {
  return typeof reason === 'string' && PLAYER_ENDED_GAME_REASONS.has(reason);
}

/** Long enough, and either the player talked or there was a goal. */
export function worthChecking(p: { durationMs: number; playerLines: number; goals: number }): boolean {
  return p.durationMs >= PLAYER_END_MIN_MS && (p.playerLines >= 2 || p.goals > 0);
}

// ── session digests from the bot port ─────────────────────────────────────

const digests = new Map<string, SessionDigest>();

function cleanLine(raw: unknown): DigestLine | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { who?: unknown; text?: unknown };
  if (typeof r.text !== 'string') return null;
  const text = r.text.replace(/\s+/g, ' ').trim().slice(0, LINE_CHARS);
  if (!text) return null;
  const who = r.who === 'you' || r.who === 'other' ? r.who : 'player';
  return { who, text };
}

/** Validate a raw {type:'session-digest'} payload. null when unusable. */
export function parseSessionDigest(raw: unknown): SessionDigest | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { lines?: unknown; playerLines?: unknown; selfLines?: unknown };
  if (!Array.isArray(r.lines)) return null;
  const lines = r.lines
    .slice(-MAX_LINES)
    .map(cleanLine)
    .filter((l): l is DigestLine => l !== null);
  const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  return { lines, playerLines: count(r.playerLines), selfLines: count(r.selfLines) };
}

/** The live bot posted its session digest (botSupervisor onSessionDigest). */
export function noteSessionDigest(characterId: string, raw: unknown): void {
  const d = parseSessionDigest(raw);
  if (d) digests.set(characterId, d);
}

/** Read and forget a character's digest (once per session close). */
export function takeSessionDigest(characterId: string): SessionDigest | null {
  const d = digests.get(characterId) ?? null;
  digests.delete(characterId);
  return d;
}

/** A new session went live: drop anything an earlier one left behind. */
export function clearSessionDigest(characterId: string): void {
  digests.delete(characterId);
}

// ── prompt ────────────────────────────────────────────────────────────────

/** Entry texts of a MEMORY.md / HEARTBEAT.md body, stamps removed, oldest first. */
export function entryTexts(body: string): string[] {
  return body
    .split('\n')
    .filter((l) => l.startsWith('- ['))
    .map((l) => l.replace(/^- \[[^\]]*\]\s*/, '').trim())
    .filter(Boolean);
}

function formatMinutes(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  return `${m} minute${m === 1 ? '' : 's'}`;
}

function speaker(l: DigestLine): string {
  if (l.who === 'you') return 'you';
  if (l.who === 'other') return 'another companion';
  return 'player';
}

export function buildPlayerEndPrompt(p: {
  name: string;
  activity: string;
  durationMs: number;
  lines: DigestLine[];
  goals: string[];
  memories: string[];
}): { system: string; user: string } {
  // {card_name}: the name as the Home card shows it ("red" reads "Red").
  const system = PLAYER_END_NEXT_STEP_SYSTEM.split('{card_name}').join(nameInSentence(p.name)).split('{name}').join(p.name);
  const parts: string[] = [`Session: ${p.activity}, about ${formatMinutes(p.durationMs)}. The player ended it.`];
  const goals = p.goals.slice(-MAX_GOALS);
  parts.push(goals.length ? `Your goals when it ended:\n${goals.map((g) => `- ${g}`).join('\n')}` : 'Your goals when it ended: none.');
  const lines = p.lines.slice(-MAX_LINES);
  parts.push(
    lines.length
      ? `The end of the conversation, oldest first:\n${lines.map((l) => `${speaker(l)}: ${l.text}`).join('\n')}`
      : 'Nobody said anything near the end.',
  );
  const memories = p.memories.slice(-MAX_MEMORIES).map((m) => m.slice(0, MEMORY_CHARS));
  if (memories.length) parts.push(`Some of your recent memories:\n${memories.map((m) => `- ${m}`).join('\n')}`);
  parts.push('Reply with the two lines (note: and player:), or with none.');
  return { system, user: parts.join('\n\n') };
}

/** One reply line as a plan note: quotes, a "Plan for next time:" lead and a trailing period dropped. */
function cleanNote(raw: string): string | null {
  let s = raw
    .trim()
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '')
    .replace(/^(plan for next time|next time|next step)\s*:\s*/i, '')
    .replace(/[.。]+$/, '')
    .trim();
  s = s.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '').trim();
  if (!s) return null;
  if (/^(none|nothing|no|n\/a)(?![a-z])/i.test(s) && s.split(/\s+/).length <= 3) return null;
  if (/^(无|没有|なし|없음)$/.test(s)) return null;
  return normalizeNextStep(s);
}

const LABELED = /^\s*[*_-]*\s*(note|player)\s*[*_]*\s*[:：]\s*[*_]*\s*(.*)$/i;

export interface PlayerEndPlan {
  /** The private note, saved to MEMORY.md as the plan. */
  step: string;
  /** The line written to the player for the Home strip; null when the model gave none. */
  line: string | null;
}

/**
 * 261014: the model's answer, `note: ...` + `player: ...` lines, as a plan
 * and its player-facing line, or null for "none". A reply without labels (an
 * older prompt, a model that ignored the format) is read the old way: its
 * first line is the note and there is no player line. This parses stored
 * notes, not speech.
 */
export function parsePlayerEndReply(text: string): PlayerEndPlan | null {
  const lines = String(text ?? '').trim().split('\n');
  let note: string | null = null;
  let player: string | null = null;
  for (const l of lines) {
    const m = LABELED.exec(l);
    if (!m) continue;
    if (m[1].toLowerCase() === 'note' && note === null) note = m[2];
    else if (m[1].toLowerCase() === 'player' && player === null) player = m[2];
  }
  if (note === null && player === null) {
    const step = cleanNote(lines[0] ?? '');
    return step ? { step, line: null } : null;
  }
  const step = cleanNote(note ?? player ?? '');
  if (!step) return null;
  const line = player !== null && cleanNote(player) ? normalizePlayerLine(player) : null;
  return { step, line };
}

/** The plan note alone (see parsePlayerEndReply), or null for "none". */
export function parseNextStepReply(text: string): string | null {
  return parsePlayerEndReply(text)?.step ?? null;
}

// ── the check ─────────────────────────────────────────────────────────────

export interface PlayerEndInput {
  characterId: string;
  surface: NextStepSurface;
  /** Analytics game id (minecraft, stardew, a backseat game id). */
  game?: string;
  /** What the session was, for the prompt ("playing Minecraft", "a voice call"). */
  activity: string;
  durationMs: number;
  lines: DigestLine[];
  playerLines: number;
  /** Read this game's goal file (HEARTBEAT[.game].md) for goals. Unset = no goals. */
  goalsGame?: string | null;
  /**
   * 261013 (T120): analytics `source`. 'app_quit' is a session the app quit
   * ended, checked on the next launch (quitNextStep.ts). Default 'player_end'.
   */
  source?: 'player_end' | 'app_quit';
  /** Extra shape-only props for the two events (T120: `late_hours`). */
  eventProps?: Record<string, string | number | boolean>;
}

export type PlayerEndOutcome =
  | 'saved'
  | 'none'
  | 'trivial'
  | 'offline'
  | 'over_limit'
  | 'busy'
  | 'timeout'
  | 'error'
  | 'cancelled'
  | 'no_character';

export interface PlayerEndDeps {
  buildProvider(): Promise<LlmProvider>;
  /** Electron net.isOnline(); only consulted for remote providers. */
  isOnline(): boolean;
  /** Cloud account over its limit (fails open: false on any error / BYOK). */
  overLimit(): Promise<boolean>;
  readText(file: string): Promise<string>;
  memoryFile(characterId: string): string;
  goalsFile(characterId: string, game: string): string;
  characterName(characterId: string): Promise<string | null>;
  /** Append the plan line. false = not written (duplicate, scope moved). */
  save(characterId: string, line: string): Promise<boolean>;
  /**
   * 261013 (T119): record where a just-saved plan came from, for the Home
   * "up next" card (homeNextStep.ts). Optional; best-effort. 261014: plus
   * the line written to the player for that card, when the model gave one.
   */
  tagPlan?(characterId: string, surface: NextStepSurface, game: string | undefined, line?: string | null): Promise<void>;
  capture(event: string, props: Record<string, unknown>): void;
  /** The deadline for one call on this provider (providerTimeoutMs). */
  timeoutMs(provider: LlmProvider, ms: number): number;
  /** Run the check as a scoped turn (scopeBarrier.withScopedTurn). */
  scoped<T>(fn: () => Promise<T>): Promise<T>;
  now(): number;
  log(msg: string): void;
}

class Timeout extends Error {}

function withDeadline<T>(p: Promise<T>, ms: number, ctrl: AbortController): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Reject first so the race reports a timeout, not the abort it causes.
      reject(new Timeout());
      ctrl.abort();
    }, ms);
    timer.unref?.();
  });
  const aborted = new Promise<never>((_, reject) => {
    if (ctrl.signal.aborted) reject(new Error('aborted'));
    ctrl.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  return Promise.race([p, deadline, aborted]).finally(() => clearTimeout(timer));
}

async function readGoals(deps: PlayerEndDeps, input: PlayerEndInput): Promise<string[]> {
  if (!input.goalsGame) return [];
  try {
    return entryTexts(await deps.readText(deps.goalsFile(input.characterId, input.goalsGame)));
  } catch {
    return [];
  }
}

/**
 * One check, start to finish. Never throws. `ctrl` aborts it (a new session
 * on a local model, tests); the deadline aborts it too.
 */
export async function runPlayerEndNextStep(
  input: PlayerEndInput,
  deps: PlayerEndDeps,
  ctrl: AbortController = new AbortController(),
): Promise<PlayerEndOutcome> {
  const { characterId } = input;
  const short = characterId.slice(0, 8);
  let provider: LlmProvider | null = null;
  let reachedModel = false;
  const outcome = await (async (): Promise<PlayerEndOutcome> => {
    try {
      const goals = await readGoals(deps, input);
      if (!worthChecking({ durationMs: input.durationMs, playerLines: input.playerLines, goals: goals.length })) {
        return 'trivial';
      }
      provider = await deps.buildProvider();
      const local = provider.kind === 'ollama';
      if (!local && !deps.isOnline()) return 'offline';
      const budget = deps.timeoutMs(provider, PLAYER_END_TIMEOUT_MS);
      return await withDeadline(
        (async (): Promise<PlayerEndOutcome> => {
          if (await deps.overLimit()) return 'over_limit';
          const name = (await deps.characterName(characterId)) ?? null;
          if (!name) return 'no_character';
          let memories: string[] = [];
          try {
            memories = entryTexts(await deps.readText(deps.memoryFile(characterId)));
          } catch {
            /* no memory yet */
          }
          const prompt = buildPlayerEndPrompt({
            name,
            activity: input.activity,
            durationMs: input.durationMs,
            lines: input.lines,
            goals,
            memories,
          });
          reachedModel = true;
          const res = await provider!.call({
            maxTokens: PLAYER_END_MAX_TOKENS,
            system: prompt.system,
            messages: [{ role: 'user', content: prompt.user }],
            timeoutMs: budget,
            signal: ctrl.signal,
          });
          if (ctrl.signal.aborted) return 'cancelled';
          const plan = parsePlayerEndReply(res.text);
          const step = plan?.step ?? null;
          const u = res.usage ?? {};
          deps.log(
            `[sei/next-step] ${short} player-end check: ${step ? `plan (${step.length} chars${plan?.line ? `, line ${plan.line.length}` : ', no line'})` : 'none'}, ` +
              `in ${u.input_tokens ?? 0} / out ${u.output_tokens ?? 0} tokens`,
          );
          if (!step) return 'none';
          const saved = await deps.save(characterId, nextStepMemoryLine(step));
          if (saved && deps.tagPlan) {
            try {
              await deps.tagPlan(characterId, input.surface, input.game, plan?.line ?? null);
            } catch {
              /* the card falls back to the games picker */
            }
          }
          return saved ? 'saved' : 'none';
        })(),
        budget,
        ctrl,
      );
    } catch (err) {
      if (err instanceof Timeout) return 'timeout';
      if (ctrl.signal.aborted) return 'cancelled';
      deps.log(`[sei/next-step] ${short} player-end check failed: ${(err as Error)?.message ?? err}`);
      return 'error';
    }
  })();
  if (reachedModel && outcome !== 'cancelled') {
    const base = {
      character_id: characterId,
      source: input.source ?? 'player_end',
      surface: input.surface,
      ...(input.game ? { game: input.game } : {}),
      ...(input.eventProps ?? {}),
    };
    try {
      deps.capture('next_step_checked', { ...base, saved: outcome === 'saved', outcome });
      if (outcome === 'saved') deps.capture('next_step_saved', base);
    } catch {
      /* analytics is never load-bearing */
    }
  }
  return outcome;
}

// ── scheduling ────────────────────────────────────────────────────────────

const inflight = new Map<string, { ctrl: AbortController; local: boolean | null; always: boolean }>();
const lastRun = new Map<string, number>();

/**
 * Start a check in the background. Never rejects. Skipped ('busy') while one
 * is running for the character or one ran inside DEDUPE_WINDOW_MS.
 * `yieldAlways` (T120, a deferred app-quit check): a new session aborts it on
 * any provider, since a plan saved after the new greeting is already stale.
 */
export function startPlayerEndNextStep(
  input: PlayerEndInput,
  deps?: PlayerEndDeps,
  opts: { yieldAlways?: boolean } = {},
): Promise<PlayerEndOutcome> {
  const { characterId } = input;
  const d = deps ?? defaultDeps();
  const now = d.now();
  const prev = lastRun.get(characterId);
  if (inflight.has(characterId) || (prev !== undefined && now - prev < DEDUPE_WINDOW_MS)) {
    return Promise.resolve('busy');
  }
  lastRun.set(characterId, now);
  const ctrl = new AbortController();
  const entry = { ctrl, local: null as boolean | null, always: opts.yieldAlways === true };
  inflight.set(characterId, entry);
  const tracked: PlayerEndDeps = {
    ...d,
    buildProvider: async () => {
      const p = await d.buildProvider();
      entry.local = p.kind === 'ollama';
      return p;
    },
  };
  return d
    .scoped(() => runPlayerEndNextStep(input, tracked, ctrl))
    .catch((): PlayerEndOutcome => 'cancelled')
    .finally(() => {
      if (inflight.get(characterId) === entry) inflight.delete(characterId);
    });
}

/**
 * A new session for this character is starting. A check on a LOCAL model is
 * aborted so it does not compete with the session for the same machine, and
 * so is a deferred app-quit check on any model (`yieldAlways`).
 */
export function yieldToNewSession(characterId: string): void {
  const entry = inflight.get(characterId);
  if (entry && (entry.always || entry.local !== false)) entry.ctrl.abort();
}

/** Tests only. */
export function _resetPlayerEndNextStep(): void {
  for (const e of inflight.values()) e.ctrl.abort();
  inflight.clear();
  lastRun.clear();
  digests.clear();
}

// ── production wiring ─────────────────────────────────────────────────────

function defaultDeps(): PlayerEndDeps {
  return {
    async buildProvider() {
      const { buildLlmProvider } = await import('./llm');
      return buildLlmProvider();
    },
    isOnline: () => onlineNow(),
    async overLimit() {
      try {
        const { cloudOverLimit } = await import('./cloud/proxyClient');
        return await cloudOverLimit();
      } catch {
        return false;
      }
    },
    readText: (file) => readFile(file, 'utf8'),
    memoryFile(characterId) {
      return path.join(memoryDirOf(characterId), 'MEMORY.md');
    },
    goalsFile(characterId, game) {
      return goalsFileFor(memoryDirOf(characterId), game);
    },
    async characterName(characterId) {
      const { getCharacter } = await import('./characterStore');
      return (await getCharacter(characterId))?.name ?? null;
    },
    async save(characterId, line) {
      const { scopedTurnCurrent, trackScopedWrite } = await import('./profile/scopeBarrier');
      if (!scopedTurnCurrent()) return false;
      const { appendMemory } = await import('../bot/brain/memory/memoryLog.js');
      const written = await trackScopedWrite(appendMemory(path.join(memoryDirOf(characterId), 'MEMORY.md'), line));
      if (written > 0) {
        try {
          const { maybeCompactChatMemory } = await import('./chat/memoryCompaction');
          void maybeCompactChatMemory(characterId).catch(() => {});
        } catch {
          /* compaction is best-effort */
        }
      }
      return written > 0;
    },
    async tagPlan(characterId, surface, game, line) {
      const { scopedTurnCurrent, trackScopedWrite } = await import('./profile/scopeBarrier');
      if (!scopedTurnCurrent()) return;
      const { tagLatestPlan, noteHomeNextStepChanged } = await import('./homeNextStep');
      const dir = memoryDirOf(characterId);
      if (await trackScopedWrite(tagLatestPlan(dir, { surface, game, line }))) noteHomeNextStepChanged(characterId);
    },
    capture(event, props) {
      void (async () => {
        try {
          // One cached import: the checked + saved pair fires in the same tick,
          // and two concurrent dynamic imports can resolve to different module
          // instances under vitest mocking (lazyAnalytics.ts).
          lazyAnalytics ??= import('./lazyAnalytics').catch((err) => {
            lazyAnalytics = null;
            throw err;
          });
          const { loadAnalytics } = await lazyAnalytics;
          const { capture } = await loadAnalytics();
          capture(event, props);
        } catch {
          /* analytics is never load-bearing */
        }
      })();
    },
    timeoutMs(provider, ms) {
      return timeoutFor(provider, ms);
    },
    async scoped(fn) {
      const { withScopedTurn } = await import('./profile/scopeBarrier');
      return withScopedTurn(fn);
    },
    now: () => Date.now(),
    log: (msg) => console.log(msg),
  };
}

let lazyAnalytics: Promise<typeof import('./lazyAnalytics')> | null = null;

let boundMemoryDir: ((characterId: string) => string) | null = null;
/** Unbound (bindPlayerEndRuntime never ran) = refuse, never a relative path. */
function memoryDirOf(characterId: string): string {
  if (!boundMemoryDir) throw new Error('player-end next step: runtime not bound');
  return boundMemoryDir(characterId);
}
let timeoutFor: (provider: LlmProvider, ms: number) => number = (_p, ms) => ms;
let onlineNow: () => boolean = () => true;

/**
 * Production bindings that need main-only modules (paths, the llm layer's
 * timeout floors, Electron's net). index.ts calls this once at startup; tests inject deps.
 */
export function bindPlayerEndRuntime(b: {
  memoryDir: (characterId: string) => string;
  providerTimeoutMs: (provider: LlmProvider, ms: number) => number;
  /** Electron net.isOnline(). */
  isOnline: () => boolean;
}): void {
  boundMemoryDir = b.memoryDir;
  timeoutFor = b.providerTimeoutMs;
  onlineNow = b.isOnline;
}

/** The goal file a game session's bot wrote (bot/index.js heartbeat_md_path). */
export function goalsFileFor(memoryDir: string, game: string): string {
  return path.join(memoryDir, game === 'minecraft' ? 'HEARTBEAT.md' : `HEARTBEAT.${game}.md`);
}
