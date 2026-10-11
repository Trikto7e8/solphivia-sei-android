// 261011: the first-spawn greeting no longer assumes a shared past.
// Quality eval 2026-10-11: with empty memory she opened "yo alex, back in the
// world" (first_meeting) and "you actually made it back" (building), because
// the only FIRST CONTACT wording said to greet them "like you're glad to be
// back". Harness mirrors orchestrator.stopVsEndLoop.test.js.

import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import { z } from 'zod'
import { createOrchestrator, _setTickIntervalForTests } from './orchestrator.js'

function makeProvider(script) {
  let i = 0
  const calls = []
  return {
    calls,
    capabilities: { vision: false, cached: false, local: false },
    buildCachedSystem: (blocks) => blocks,
    setAuthToken() {},
    setBackend() {},
    async call(args) {
      calls.push(args)
      const r = script[Math.min(i, script.length - 1)]
      i += 1
      if (typeof r === 'function') return r(args)
      return r
    },
  }
}

// gather runs until aborted (a long foreground job); follow never settles
// (background trail); unfollow and goTo settle at once.
function makeAdapter() {
  const executed = []
  const aborted = []
  const adapter = {
    listActions: () => ['gather', 'goTo', 'follow', 'unfollow'],
    getActionSchema: () => z.object({ name: z.string().optional(), player: z.string().optional() }),
    getActionDescription: (n) => `do ${n}`,
    capabilityParagraph: () => 'caps',
    worldPrimer: () => 'world',
    actionRules: () => 'rules',
    eventAddendum: () => '',
    createSnapshotComposer: () => ({ next: () => 'SNAPSHOT' }),
    chat: vi.fn(),
    closeAnySessions: async () => {},
    executeAction: (name, args, opts) => {
      executed.push(name)
      if (name === 'gather') {
        return new Promise((resolve) => {
          const sig = opts?.signal
          if (sig) sig.addEventListener('abort', () => { aborted.push(name); resolve('aborted after 2/12 oak_log') }, { once: true })
        })
      }
      if (name === 'follow') return new Promise(() => {})
      return Promise.resolve(`${name} ok`)
    },
  }
  return { adapter, executed, aborted }
}

function makeConfig() {
  return {
    player_username: 'Steve',
    preferred_name: 'Steve',
    persona: { name: 'Sei', expanded: 'You are a sharp little companion.' },
    anthropic: { model: 'claude-haiku-4-5', timeout_ms: 20_000, max_retries: 1 },
    llm: { provider: 'anthropic', rate_limit_per_min: 60, debounce_ms: 0, max_hops: 5 },
    memory: {
      memory_md_path: path.join(os.tmpdir(), `sei-firstcontact-test-${process.pid}-${Date.now()}-${Math.random()}.md`),
      iteration_cap: 30,
    },
  }
}

const chat = (text) => ({ text, username: 'Steve', playerSpoke: true, ts: Date.now() })
const flush = () => new Promise((r) => setTimeout(r, 0))
const gatherTurn = { text: '', toolUses: [{ id: 'g1', name: 'gather', input: { name: 'oak_log' } }] }

function toolResultsOf(call) {
  const out = []
  for (const m of call?.messages ?? []) {
    if (!Array.isArray(m.content)) continue
    for (const b of m.content) if (b.type === 'tool_result') out.push(b)
  }
  return out
}


const firstTurnText = (provider) => JSON.stringify(provider.calls[0]?.messages ?? provider.calls[0])

describe('261011 FIRST CONTACT wording follows the memory', () => {
  it('with no memory the greeting is framed as a first meeting', async () => {
    _setTickIntervalForTests(10_000_000)
    const provider = makeProvider([{ text: '', toolUses: [] }])
    const { adapter } = makeAdapter()
    const orch = createOrchestrator({ adapter, config: makeConfig(), reenqueue: () => {}, _anthropicOverride: provider })
    await orch.handleDispatch('sei:idle', { reason: 'just_connected_first_spawn', quietMs: 0 })
    const t = firstTurnText(provider)
    expect(t).toContain('FIRST CONTACT')
    expect(t).toContain('first time you two have played together')
    expect(t).not.toContain('glad (or smug) to be back')
  })

  it('with a past memory entry the returning-friend wording is kept', async () => {
    _setTickIntervalForTests(10_000_000)
    const provider = makeProvider([{ text: '', toolUses: [] }])
    const { adapter } = makeAdapter()
    const config = makeConfig()
    fs.writeFileSync(config.memory.memory_md_path, '# Memory\n\n- [2026-10-01 12:00] steve likes building castles\n')
    const orch = createOrchestrator({ adapter, config, reenqueue: () => {}, _anthropicOverride: provider })
    await orch.handleDispatch('sei:idle', { reason: 'just_connected_first_spawn', quietMs: 0 })
    const t = firstTurnText(provider)
    expect(t).toContain('glad (or smug) to be back')
    expect(t).not.toContain('first time you two have played together')
  })
})
