// 261023: MC quality pass 25.
//  - next_time and goodbye wording follow real progress: a goal set this
//    session that no world work has followed is marked not started in the
//    heartbeat (seed block and the mid-loop heartbeatNow list), and the
//    next_time texts ask for "start" or "try" on those and "finish" only on
//    work that was begun (pass 24 probe bye_own: "finish the starter base"
//    about a goal never started, 6 of 8).
//  - the player's safety and feelings come before her own goal (agentic
//    directive and the own-goal heads).

import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { z } from 'zod'
import {
  countsAsGoalWork, goalNotStarted, goalStampMs, markGoalProgress, GOAL_NOT_STARTED_NOTE,
} from './goalProgress.js'
import {
  NUDGES, NEXT_TIME_FIELD, NEXT_TIME_GOODBYE, NEXT_TIME_FOR_PLAYER_FIELD, PROACTIVENESS_DIRECTIVES, renderHeartbeat,
} from './promptLibrary.js'
import { createOrchestrator, _setTickIntervalForTests } from './orchestrator.js'

afterEach(() => { vi.restoreAllMocks() })

const T0 = Date.parse('2026-10-23T10:00:00.000Z')
const at = (ms) => new Date(ms).toISOString()
const goalLine = (ms, text) => `- [${at(ms)}] ${text}`

describe('countsAsGoalWork', () => {
  it('counts finished world work, partial or aborted with progress', () => {
    expect(countsAsGoalWork('gather', 'gathered 4/4 oak_log')).toBe(true)
    expect(countsAsGoalWork('gather', 'gathered 2/8 oak_log')).toBe(true)
    expect(countsAsGoalWork('craft', 'crafted 1 crafting_table')).toBe(true)
    expect(countsAsGoalWork('gather', 'aborted after 2/10 oak_log')).toBe(true)
  })

  it('does not count moves, looks, failures, empty aborts, fights, eating or sleep', () => {
    expect(countsAsGoalWork('goTo', 'arrived')).toBe(false)
    expect(countsAsGoalWork('look', 'looked around')).toBe(false)
    expect(countsAsGoalWork('dig', 'no coal within 4m')).toBe(false)
    expect(countsAsGoalWork('gather', 'aborted')).toBe(false)
    expect(countsAsGoalWork('gather', 'aborted after 0/10 oak_log')).toBe(false)
    expect(countsAsGoalWork('gather', 'gathered 0/8 oak_log')).toBe(false)
    expect(countsAsGoalWork('attackEntity', 'killed zombie (4 hits)')).toBe(false)
    expect(countsAsGoalWork('consumeItem', 'ate bread')).toBe(false)
    expect(countsAsGoalWork('sleep', 'slept until morning')).toBe(false)
    expect(countsAsGoalWork('', 'gathered 4/4 oak_log')).toBe(false)
  })
})

describe('goalNotStarted', () => {
  const line = goalLine(T0 + 60_000, 'Build a starter hut. Done when it has a roof.')

  it('reads the stamp', () => {
    expect(goalStampMs(line)).toBe(T0 + 60_000)
    expect(Number.isNaN(goalStampMs('no stamp'))).toBe(true)
  })

  it('is true for a goal set this session with no work since', () => {
    expect(goalNotStarted(line, { sessionStartMs: T0, lastWorkAt: null })).toBe(true)
    // Work that finished before the goal was set does not start it.
    expect(goalNotStarted(line, { sessionStartMs: T0, lastWorkAt: T0 + 30_000 })).toBe(true)
  })

  it('is false once work has finished since it was set', () => {
    expect(goalNotStarted(line, { sessionStartMs: T0, lastWorkAt: T0 + 60_000 })).toBe(false)
    expect(goalNotStarted(line, { sessionStartMs: T0, lastWorkAt: T0 + 90_000 })).toBe(false)
  })

  it('leaves unknown cases unmarked: earlier session, no session start, no stamp', () => {
    expect(goalNotStarted(goalLine(T0 - 1, 'old goal'), { sessionStartMs: T0, lastWorkAt: null })).toBe(false)
    expect(goalNotStarted(line, { sessionStartMs: null, lastWorkAt: null })).toBe(false)
    expect(goalNotStarted('- [garbage] x', { sessionStartMs: T0, lastWorkAt: null })).toBe(false)
  })

  it('markGoalProgress notes only the not-started lines', () => {
    const text = [goalLine(T0 - 5, 'old one'), goalLine(T0 + 10, 'new one')].join('\n')
    const out = markGoalProgress(text, { sessionStartMs: T0, lastWorkAt: null })
    expect(out.split('\n')[0]).toBe(goalLine(T0 - 5, 'old one'))
    expect(out.split('\n')[1]).toBe(`${goalLine(T0 + 10, 'new one')} ${GOAL_NOT_STARTED_NOTE}`)
    expect(markGoalProgress(text, { sessionStartMs: null })).toBe(text)
  })
})

describe('renderHeartbeat marks not-started goals', () => {
  const own = goalLine(T0 + 10, 'Build a starter hut.')
  const task = goalLine(T0 + 20, '(player task) get Steve 8 oak logs')
  const notStarted = (l) => goalNotStarted(l, { sessionStartMs: T0, lastWorkAt: null })

  it('marks own goals and this session\'s tasks', () => {
    const hb = renderHeartbeat(2, own, '', { sessionStartMs: T0, notStarted })
    expect(hb).toContain(`${own} ${GOAL_NOT_STARTED_NOTE}`)
    const both = renderHeartbeat(2, `${task}\n${own}`, '', { sessionStartMs: T0, notStarted })
    expect(both).toContain(`${task} ${GOAL_NOT_STARTED_NOTE}`)
    expect(both).toContain(`${own} ${GOAL_NOT_STARTED_NOTE}`)
  })

  it('is unchanged without the callback', () => {
    const hb = renderHeartbeat(2, own, '', { sessionStartMs: T0 })
    expect(hb).not.toContain(GOAL_NOT_STARTED_NOTE)
  })

  it('heartbeatNow appends the note after the clipped text', () => {
    const long = `build ${'a very long goal text '.repeat(12)}`
    const t = NUDGES.heartbeatNow([{ text: long, notStarted: true }, { text: 'second', notStarted: false }, 'third'])
    const rows = t.split('\n')
    expect(rows[1].endsWith(`... ${GOAL_NOT_STARTED_NOTE}`)).toBe(true)
    expect(rows[2]).toBe('- second')
    expect(rows[3]).toBe('- third')
  })
})

describe('next_time texts follow progress', () => {
  it('asks for start or try on what was not started and finish on what was worked on', () => {
    expect(NEXT_TIME_FIELD).toContain('Write it in a few words that match how far it really got.')
    expect(NEXT_TIME_FIELD).toContain('Something you have worked on is one to finish or keep going, like "finish the roof".')
    expect(NEXT_TIME_FIELD).toContain('Something you have not started yet, including any goal marked not started yet, is one to start or try, like "start the roof".')
    expect(NEXT_TIME_GOODBYE).toContain('"next time I\'ll start on the roof" or "next time we finish the roof", whichever matches how far it got')
    expect(NEXT_TIME_FOR_PLAYER_FIELD).toContain('"Start the cabin roof", "Finish the cabin roof"')
  })

  it('has no em or en dashes', () => {
    for (const t of [NEXT_TIME_FIELD, NEXT_TIME_GOODBYE, NEXT_TIME_FOR_PLAYER_FIELD, GOAL_NOT_STARTED_NOTE]) expect(t).not.toMatch(/[–—]/)
  })
})

describe('the player comes before her own goal', () => {
  const RULE = 'The player\'s safety and how they feel come before your goal too. When they say they are scared or nervous or ask you to stay close, or when it gets dark or hostile mobs come near them, put your goal on hold: stay by them, keep them safe, and keep talking with them. Go back to your goal once they are safe and feel okay, or when they tell you to go.'
  const HEAD = 'The player comes before these goals: while they are scared, have asked you to stay close, or are in danger from the dark or from mobs, stay with them and keep them safe, and pick a goal back up once they are okay.'

  it('the agentic directive says so', () => {
    expect(PROACTIVENESS_DIRECTIVES[2]).toContain(RULE)
    expect(RULE).not.toMatch(/[–—]/)
  })

  it('the own-goal heads say so, the on-hold head does not need to', () => {
    expect(renderHeartbeat(2, goalLine(T0, 'Build a hut.'), '')).toContain(HEAD)
    expect(renderHeartbeat(2, `${goalLine(T0, '(player task) get logs')}\n${goalLine(T0, 'Build a hut.')}`, '')).toContain(HEAD)
    expect(HEAD).not.toMatch(/[–—]/)
  })
})

// --- orchestrator wiring ---------------------------------------------------

function makeProvider(script) {
  let i = 0
  const calls = []
  return {
    calls,
    buildCachedSystem: (blocks) => blocks,
    setAuthToken() {},
    setBackend() {},
    async call(args) {
      calls.push(JSON.parse(JSON.stringify({ messages: args.messages ?? [] })))
      const r = script[Math.min(i, script.length - 1)]
      i += 1
      return typeof r === 'function' ? r(args) : r
    },
  }
}

function makeAdapter(running) {
  return {
    listActions: () => ['gather', 'goTo'],
    getActionSchema: () => z.object({ name: z.string().optional(), count: z.number().optional(), player: z.string().optional() }),
    getActionDescription: (a) => `do ${a}`,
    capabilityParagraph: () => 'caps',
    worldPrimer: () => 'world',
    actionRules: () => 'rules',
    eventAddendum: () => '',
    createSnapshotComposer: () => ({ next: () => 'SNAPSHOT' }),
    chat: vi.fn(),
    closeAnySessions: async () => {},
    executeAction: (name, _args, opts = {}) => {
      if (name !== 'gather') return Promise.resolve(`${name} ok`)
      return new Promise((resolve) => {
        running[name] = resolve
        opts.signal?.addEventListener?.('abort', () => resolve('aborted'), { once: true })
      })
    },
  }
}

let seq = 0
function config() {
  const tag = `${process.pid}-${Date.now()}-${seq++}`
  return {
    player_username: 'Steve',
    preferred_name: 'Steve',
    persona: { name: 'Sei', expanded: 'You are a sharp little companion.', proactiveness: 2 },
    anthropic: { model: 'claude-haiku-4-5', timeout_ms: 20_000, max_retries: 1 },
    llm: { provider: 'anthropic', rate_limit_per_min: 60, debounce_ms: 0, max_hops: 5 },
    memory: {
      memory_md_path: path.join(os.tmpdir(), `sei-p25-mem-${tag}.md`),
      heartbeat_md_path: path.join(os.tmpdir(), `sei-p25-hb-${tag}.md`),
      iteration_cap: 30,
    },
    web: { enabled: false },
  }
}

const say = (id, text) => ({ id, name: 'say', input: { text } })
const act = (id, name, input = {}) => ({ id, name, input })
const turn = (...toolUses) => ({ text: '', toolUses })
const lastUser = (call) => JSON.stringify(call.messages.slice(-1))
const allText = (call) => JSON.stringify(call.messages)
const line = (text) => ({ text, username: 'Steve', playerSpoke: true, ts: Date.now() })
const DRAINED = new Set(['sei:action_complete', 'sei:chat_received', 'sei:action_tick'])
const flush = () => new Promise((r) => setTimeout(r, 5))
const NOTE_JSON = JSON.stringify(GOAL_NOT_STARTED_NOTE).slice(1, -1)

function setup(script) {
  _setTickIntervalForTests(10_000_000)
  const running = {}
  const queue = []
  const provider = makeProvider(script)
  const orch = createOrchestrator({
    adapter: makeAdapter(running), config: config(),
    sessionState: { playerData: () => ({}), onLoopTerminal: async () => {} },
    playerStore: { formatPlayerSeedBlock: () => 'PLAYER' },
    reenqueue: (event, data) => queue.push({ event, data }),
    _anthropicOverride: provider,
  })
  const drain = async () => {
    for (let guard = 0; queue.length && guard < 20; guard++) {
      const next = queue.shift()
      if (DRAINED.has(next.event)) await orch.handleDispatch(next.event, next.data)
    }
  }
  return { orch, provider, running, drain }
}

describe('orchestrator: a goal is marked not started until work finishes after it', () => {
  it('marks the goal on the next line, and drops the mark once a gather finished', async () => {
    const { orch, provider, running, drain } = setup([
      turn(say('s1', 'hey'), act('g1', 'setGoal', { text: 'Build a starter hut. Done when it has a roof.' }), act('e1', 'end_loop')),
      turn(say('s2', 'ok'), act('a1', 'gather', { name: 'oak_log', count: 4 })),
      turn(act('e2', 'end_loop')),
      turn(say('s3', 'later'), act('e3', 'end_loop')),
    ])
    orch.recordIncomingChat('Steve', 'hi')
    await orch.handleDispatch('sei:chat_received', line('hi'))
    await flush(); await drain(); await flush()

    orch.recordIncomingChat('Steve', 'grab some wood')
    await orch.handleDispatch('sei:chat_received', line('grab some wood'))
    await flush()
    const before = provider.calls.find((c) => lastUser(c).includes('grab some wood'))
    expect(before).toBeTruthy()
    // Seed heartbeat of the new loop and the heartbeatNow list both carry it.
    expect(allText(before)).toContain(`Build a starter hut. Done when it has a roof. ${NOTE_JSON}`)

    running.gather('gathered 4/4 oak_log')
    await flush(); await drain(); await flush()

    orch.recordIncomingChat('Steve', 'ok bye')
    await orch.handleDispatch('sei:chat_received', line('ok bye'))
    await flush(); await drain(); await flush()
    const after = provider.calls.find((c) => lastUser(c).includes('ok bye'))
    expect(after).toBeTruthy()
    expect(allText(after)).toContain('Build a starter hut. Done when it has a roof.')
    expect(allText(after)).not.toContain(NOTE_JSON)
  })
})
