import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LlmCallParams, LlmProvider } from './llm/types';
import {
  DEDUPE_WINDOW_MS,
  PLAYER_END_MAX_TOKENS,
  PLAYER_END_MIN_MS,
  _resetPlayerEndNextStep,
  buildPlayerEndPrompt,
  isPlayerEndedGame,
  noteSessionDigest,
  parseNextStepReply,
  runPlayerEndNextStep,
  startPlayerEndNextStep,
  takeSessionDigest,
  worthChecking,
  yieldToNewSession,
  type PlayerEndDeps,
  type PlayerEndInput,
} from './playerEndNextStep';

function provider(
  reply: string | ((p: LlmCallParams) => Promise<string>),
  kind = 'anthropic',
): LlmProvider & { calls: LlmCallParams[] } {
  const calls: LlmCallParams[] = [];
  return {
    calls,
    backend: 'cloud-proxy',
    kind,
    model: 'claude-haiku-5-5',
    vision: 'yes' as never,
    streaming: false,
    async call(p: LlmCallParams) {
      calls.push(p);
      const text = typeof reply === 'string' ? reply : await reply(p);
      return { text, usage: { input_tokens: 900, output_tokens: 8 } } as never;
    },
  };
}

const GOALS = '# Goals\n\n- [2026-10-11T10:00:00.000Z] finish the cabin roof\n';
const MEMORY = '# Memory\n\n- [2026-10-10T10:00:00.000Z] Shawn has a job interview on Monday\n';

function deps(over: Partial<PlayerEndDeps> = {}, llm: LlmProvider = provider('finish the cabin roof')) {
  const saved: Array<[string, string]> = [];
  const events: Array<[string, Record<string, unknown>]> = [];
  const d: PlayerEndDeps = {
    buildProvider: async () => llm,
    isOnline: () => true,
    overLimit: async () => false,
    readText: async (file) => (file.includes('HEARTBEAT') ? GOALS : MEMORY),
    memoryFile: (id) => `/mem/${id}/MEMORY.md`,
    goalsFile: (id, game) => `/mem/${id}/${game === 'minecraft' ? 'HEARTBEAT.md' : `HEARTBEAT.${game}.md`}`,
    characterName: async () => 'Sui',
    save: async (id, line) => {
      saved.push([id, line]);
      return true;
    },
    capture: (e, p) => events.push([e, p]),
    timeoutMs: (_p, ms) => ms,
    scoped: (fn) => fn(),
    now: () => 1_000_000,
    log: () => {},
    ...over,
  };
  return { d, saved, events };
}

const input = (over: Partial<PlayerEndInput> = {}): PlayerEndInput => ({
  characterId: 'char-1',
  surface: 'game',
  game: 'minecraft',
  activity: 'playing Minecraft together',
  durationMs: 25 * 60_000,
  lines: [
    { who: 'player', text: 'can we put a roof on the cabin' },
    { who: 'you', text: 'yes, I need more spruce planks first' },
    { who: 'player', text: 'ok I have to go eat, bye' },
  ],
  playerLines: 9,
  goalsGame: 'minecraft',
  ...over,
});

afterEach(() => {
  _resetPlayerEndNextStep();
  vi.useRealTimers();
});

describe('who counts as the player ending it', () => {
  it('stop, world close and disconnect only', () => {
    for (const r of ['user_stop', 'world_closed', 'disconnected']) expect(isPlayerEndedGame(r)).toBe(true);
    for (const r of ['companion_quit', 'app_quit', 'account_switch', 'kicked', 'crash', 'credits_depleted', undefined]) {
      expect(isPlayerEndedGame(r)).toBe(false);
    }
  });
});

describe('content gate', () => {
  it('needs two minutes and either real talk or a goal', () => {
    expect(worthChecking({ durationMs: PLAYER_END_MIN_MS - 1, playerLines: 20, goals: 3 })).toBe(false);
    expect(worthChecking({ durationMs: PLAYER_END_MIN_MS, playerLines: 1, goals: 0 })).toBe(false);
    expect(worthChecking({ durationMs: PLAYER_END_MIN_MS, playerLines: 2, goals: 0 })).toBe(true);
    expect(worthChecking({ durationMs: PLAYER_END_MIN_MS, playerLines: 0, goals: 1 })).toBe(true);
  });

  it('skips a trivial session without building a provider or sending events', async () => {
    const build = vi.fn();
    const { d, saved, events } = deps({ buildProvider: build, readText: async () => '' });
    expect(await runPlayerEndNextStep(input({ durationMs: 60_000 }), d)).toBe('trivial');
    expect(await runPlayerEndNextStep(input({ playerLines: 1, goalsGame: null }), d)).toBe('trivial');
    expect(build).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
    expect(events).toEqual([]);
  });
});

describe('a player-ended session', () => {
  it('saves the plan the way T80 does and reports it, without transcript text', async () => {
    const llm = provider('"Finish the cabin roof."');
    const { d, saved, events } = deps({}, llm);
    expect(await runPlayerEndNextStep(input(), d)).toBe('saved');
    expect(saved).toEqual([['char-1', 'Plan for next time: Finish the cabin roof']]);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0].maxTokens).toBe(PLAYER_END_MAX_TOKENS);
    expect(llm.calls[0].system).toContain('You are Sui');
    const user = String(llm.calls[0].messages[0].content);
    expect(user).toContain('finish the cabin roof');
    expect(user).toContain('player: ok I have to go eat, bye');
    expect(user).toContain('job interview');
    expect(events).toEqual([
      ['next_step_checked', { character_id: 'char-1', source: 'player_end', surface: 'game', game: 'minecraft', saved: true, outcome: 'saved' }],
      ['next_step_saved', { character_id: 'char-1', source: 'player_end', surface: 'game', game: 'minecraft' }],
    ]);
    expect(JSON.stringify(events)).not.toMatch(/cabin|eat/);
  });

  it('a "none" reply saves nothing but still reports the check', async () => {
    const { d, saved, events } = deps({}, provider('none'));
    expect(await runPlayerEndNextStep(input(), d)).toBe('none');
    expect(saved).toEqual([]);
    expect(events).toEqual([
      ['next_step_checked', { character_id: 'char-1', source: 'player_end', surface: 'game', game: 'minecraft', saved: false, outcome: 'none' }],
    ]);
  });

  it('a call without goals still runs on the conversation alone', async () => {
    const llm = provider('ask how the job interview went');
    const { d, saved, events } = deps({}, llm);
    const out = await runPlayerEndNextStep(
      input({ surface: 'call', game: undefined, goalsGame: undefined, activity: 'a voice call', playerLines: 6 }),
      d,
    );
    expect(out).toBe('saved');
    expect(saved[0][1]).toBe('Plan for next time: ask how the job interview went');
    expect(String(llm.calls[0].messages[0].content)).toContain('Your goals when it ended: none.');
    expect(events[1]).toEqual(['next_step_saved', { character_id: 'char-1', source: 'player_end', surface: 'call' }]);
  });
});

describe('never a wall, never a block', () => {
  it('out of allowance: no call, no event', async () => {
    const llm = provider('finish the cabin roof');
    const { d, saved, events } = deps({ overLimit: async () => true }, llm);
    expect(await runPlayerEndNextStep(input(), d)).toBe('over_limit');
    expect(llm.calls).toHaveLength(0);
    expect(saved).toEqual([]);
    expect(events).toEqual([]);
  });

  it('offline: skipped for a remote model, allowed for Ollama', async () => {
    const remote = provider('finish the cabin roof');
    expect(await runPlayerEndNextStep(input(), deps({ isOnline: () => false }, remote).d)).toBe('offline');
    expect(remote.calls).toHaveLength(0);
    const local = provider('finish the cabin roof', 'ollama');
    expect(await runPlayerEndNextStep(input(), deps({ isOnline: () => false }, local).d)).toBe('saved');
  });

  it('a hung model is cut off at the time box and nothing is written', async () => {
    let sawAbort = false;
    const hung = provider(
      (p) =>
        new Promise<string>((_, reject) => {
          p.signal?.addEventListener('abort', () => {
            sawAbort = true;
            reject(new Error('aborted'));
          });
        }),
    );
    const { d, saved, events } = deps({ timeoutMs: () => 40 }, hung);
    const t0 = Date.now();
    expect(await runPlayerEndNextStep(input(), d)).toBe('timeout');
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(sawAbort).toBe(true);
    expect(saved).toEqual([]);
    expect(events[0][1]).toMatchObject({ saved: false, outcome: 'timeout' });
  });

  it('start returns at once and its promise never rejects', async () => {
    const { d } = deps({ buildProvider: async () => Promise.reject(new Error('no key')) });
    let settled = false;
    const p = startPlayerEndNextStep(input(), d).then((o) => {
      settled = true;
      return o;
    });
    expect(settled).toBe(false);
    expect(await p).toBe('error');
    const { d: d2 } = deps({ scoped: () => Promise.reject(new Error('ACCOUNT_SWITCHING')) });
    expect(await startPlayerEndNextStep(input({ characterId: 'char-2' }), d2)).toBe('cancelled');
  });

  it('a new session aborts a check running on a local model', async () => {
    let release: (() => void) | null = null;
    const slow = provider(
      (p) =>
        new Promise<string>((resolve, reject) => {
          release = () => resolve('finish the cabin roof');
          p.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
      'ollama',
    );
    const { d, saved, events } = deps({}, slow);
    const p = startPlayerEndNextStep(input(), d);
    await vi.waitFor(() => expect(slow.calls).toHaveLength(1));
    yieldToNewSession('char-1');
    expect(await p).toBe('cancelled');
    expect(release).not.toBeNull();
    expect(saved).toEqual([]);
    expect(events).toEqual([]);
  });

  it('a new session leaves a remote check to finish', async () => {
    let release: (() => void) | null = null;
    const slow = provider((_p) => new Promise<string>((resolve) => (release = () => resolve('finish the cabin roof'))));
    const { d, saved } = deps({}, slow);
    const p = startPlayerEndNextStep(input(), d);
    await vi.waitFor(() => expect(slow.calls).toHaveLength(1));
    yieldToNewSession('char-1');
    release!();
    expect(await p).toBe('saved');
    expect(saved).toHaveLength(1);
  });

  it('one check per character inside the dedupe window', async () => {
    let now = 1_000_000;
    const llm = provider('finish the cabin roof');
    const { d } = deps({ now: () => now }, llm);
    expect(await startPlayerEndNextStep(input(), d)).toBe('saved');
    now += DEDUPE_WINDOW_MS - 1;
    expect(await startPlayerEndNextStep(input({ surface: 'call' }), d)).toBe('busy');
    expect(await startPlayerEndNextStep(input({ characterId: 'char-2' }), d)).toBe('saved');
    now += 2;
    expect(await startPlayerEndNextStep(input(), d)).toBe('saved');
    expect(llm.calls).toHaveLength(3);
  });

  it('a plan whose write lost its scope (account switch) is not reported as saved', async () => {
    const { d, events } = deps({ save: async () => false });
    expect(await runPlayerEndNextStep(input(), d)).toBe('none');
    expect(events.map((e) => e[0])).toEqual(['next_step_checked']);
  });

  it('tags a saved plan with where it came from (Home card), and only a saved one', async () => {
    const tags: Array<[string, string, string | undefined]> = [];
    const tagPlan = async (id: string, surface: string, game: string | undefined) => {
      tags.push([id, surface, game]);
    };
    expect(await runPlayerEndNextStep(input({ game: 'stardew', goalsGame: 'stardew' }), deps({ tagPlan }).d)).toBe('saved');
    expect(tags).toEqual([['char-1', 'game', 'stardew']]);
    expect(await runPlayerEndNextStep(input({ characterId: 'char-2' }), deps({ tagPlan }, provider('none')).d)).toBe('none');
    expect(await runPlayerEndNextStep(input({ characterId: 'char-3' }), deps({ tagPlan, save: async () => false }).d)).toBe('none');
    expect(tags).toHaveLength(1);
  });

  it('a failing tag never fails the save', async () => {
    const { d, saved } = deps({ tagPlan: async () => Promise.reject(new Error('disk')) });
    expect(await runPlayerEndNextStep(input(), d)).toBe('saved');
    expect(saved).toHaveLength(1);
  });
});

describe('reply parsing', () => {
  it('takes the first line and strips wrappers', () => {
    expect(parseNextStepReply('Plan for next time: finish the roof.')).toBe('finish the roof');
    expect(parseNextStepReply('"ask how the interview went"\nbecause it matters')).toBe('ask how the interview went');
    expect(parseNextStepReply('  None.  ')).toBeNull();
    expect(parseNextStepReply('nothing')).toBeNull();
    expect(parseNextStepReply('')).toBeNull();
    expect(parseNextStepReply('没有')).toBeNull();
    expect(parseNextStepReply('no more iron, mine some next time')).toBe('no more iron, mine some next time');
  });
});

describe('digest store', () => {
  it('validates, keeps one per character and is taken once', () => {
    noteSessionDigest('a', { lines: [{ who: 'player', text: ' hi ' }, { who: 'bogus', text: 'x' }, { text: 3 }], playerLines: 4, selfLines: -1 });
    noteSessionDigest('b', 'garbage');
    expect(takeSessionDigest('a')).toEqual({
      lines: [
        { who: 'player', text: 'hi' },
        { who: 'player', text: 'x' },
      ],
      playerLines: 4,
      selfLines: 0,
    });
    expect(takeSessionDigest('a')).toBeNull();
    expect(takeSessionDigest('b')).toBeNull();
  });
});

describe('prompt', () => {
  it('stays compact', () => {
    const lines = Array.from({ length: 40 }, (_, i) => ({ who: 'player' as const, text: `line ${i} `.repeat(30) }));
    const memories = Array.from({ length: 30 }, (_, i) => `memory ${i} `.repeat(40));
    const { user } = buildPlayerEndPrompt({
      name: 'Sui',
      activity: 'a voice call',
      durationMs: 600_000,
      lines: lines.map((l) => ({ ...l, text: l.text.slice(0, 200) })),
      goals: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      memories,
    });
    expect(user.length).toBeLessThan(6_000);
    expect(user).not.toContain('- a\n');
    expect(user).toContain('about 10 minutes');
  });
});
