// scripts/quality-eval/goals/score.mjs: rule-based scoring for the goal eval.
// Reads the heartbeat after every step (the real file the orchestrator wrote)
// and the model's tool calls; no judge model. A scenario's `match` regex names
// its task in a goal line, `matchNew` the plan the player switches to.

const BRAIN = new Set(['say', 'remember', 'forget', 'setGoal', 'clearGoal', 'end_loop', 'stop', 'search', 'visit', 'quit_game', 'end_call'])

const calledIn = (step, name) => step.calls.some((c) => c.tools.some((t) => t.name === name))
const worldCalls = (step) => step.calls.flatMap((c) => c.tools.filter((t) => !BRAIN.has(t.name)))

export function scoreRun(row, sc) {
  if (row.error || !row.steps?.length) return { error: true }
  const S = row.steps
  const m = (goals) => goals.filter((g) => sc.match.test(g))
  const last = S[S.length - 1]
  const out = {}
  switch (row.scenario) {
    case 'task': {
      out.greet_selfgoal = S[0].goals.length > 0
      out.recorded = m(S[1].goals).length > 0
      out.selfgoal_left = out.recorded && S[1].goals.some((g) => !sc.match.test(g))
      out.recorded_by_setgoal = S[1].calls.some((c) => c.tools.some((t) => t.name === 'setGoal' && sc.match.test(String(t.input?.text ?? ''))))
      out.recorded_by_step2 = out.recorded || m(S[2].goals).length > 0
      // A task never named by a goal has nothing to keep, update or clear.
      if (!out.recorded_by_step2) { out.goals_at_end = last.goals.length; break }
      out.kept_after_step = m(S[2].goals).length > 0
      // Mid-task loss: the task goal was there after step 1 and gone after the
      // first finished step, while the task was not done yet.
      out.lost_midway = out.recorded && !out.kept_after_step
      out.lost_by = !out.lost_midway ? null : calledIn(S[2], 'clearGoal') ? 'model' : 'auto'
      out.updated_after_step = out.kept_after_step && m(S[2].goals).join('|') !== m(S[1].goals).join('|')
      out.cleared_at_end = m(last.goals).length === 0
      out.cleared_by = !out.cleared_at_end ? 'none'
        : S.slice(1).some((s) => calledIn(s, 'clearGoal')) ? 'model' : 'auto'
      out.dup = S.some((s) => m(s.goals).length > 1)
      out.goals_at_end = last.goals.length
      break
    }
    case 'change': {
      out.greet_selfgoal = S[0].goals.length > 0
      out.recorded = m(S[1].goals).length > 0
      out.old_removed = out.recorded ? m(S[2].goals).length === 0 : null
      out.old_removed_by_model = out.old_removed && out.recorded && calledIn(S[2], 'clearGoal')
      out.new_recorded = S[2].goals.some((g) => sc.matchNew.test(g) && !sc.match.test(g))
      out.goals_at_end = last.goals.length
      break
    }
    case 'done_said':
    case 'stale': {
      out.cleared = m(last.goals).length === 0
      out.clear_called = calledIn(last, 'clearGoal')
      out.world_actions = worldCalls(last).map((t) => t.name)
      out.goals_at_end = last.goals.length
      break
    }
    case 'oneshot': {
      out.greet_selfgoal = S[0].goals.length > 0
      const before = new Set(S[0].goals)
      out.spurious_goal = S[1].goals.some((g) => !before.has(g) && sc.match.test(g))
      out.any_new_goal = S[1].goals.some((g) => !before.has(g))
      break
    }
  }
  return out
}

const pct = (k, n) => (n ? `${k}/${n} (${Math.round((100 * k) / n)}%)` : '-')

/** Per game, per metric: k/n. */
export function tally(rows) {
  const t = {}
  for (const r of rows) {
    if (!r || r.score?.error || !r.score) continue
    const g = (t[r.game] ??= {})
    for (const [k, v] of Object.entries(r.score)) {
      if (typeof v !== 'boolean') continue
      const key = `${r.scenario}.${k}`
      const c = (g[key] ??= [0, 0])
      c[1]++
      if (v) c[0]++
    }
    if (r.score.lost_by) {
      const c = (g[`task.lost_by_${r.score.lost_by}`] ??= [0, 0])
      c[0]++
    }
    if (r.score.cleared_by) {
      const c = (g[`task.cleared_by_${r.score.cleared_by}`] ??= [0, 0])
      c[0]++
    }
  }
  return t
}

const ROWS = [
  ['task.greet_selfgoal', 'Greeting: set its own goal (agentic)'],
  ['task.recorded', 'Multi-step task: a goal names it after the request'],
  ['task.recorded_by_setgoal', 'Multi-step task: setGoal called for it on the request turn'],
  ['task.recorded_by_step2', 'Multi-step task: named by a goal within one more turn'],
  ['task.selfgoal_left', 'Multi-step task: own goal left beside it'],
  ['task.kept_after_step', 'After a step finished: task goal still there'],
  ['task.lost_midway', 'Task goal deleted before the task was done'],
  ['task.updated_after_step', 'After a step finished: goal text updated'],
  ['task.cleared_at_end', 'Task done: goal cleared'],
  ['task.dup', 'Task goal duplicated at some point'],
  ['change.recorded', 'Change of plan: first task recorded'],
  ['change.old_removed', 'Change of plan: old goal removed'],
  ['change.old_removed_by_model', 'Change of plan: model called clearGoal on the old goal'],
  ['change.new_recorded', 'Change of plan: new plan recorded'],
  ['done_said.cleared', 'Player says the task is done: cleared'],
  ['stale.clear_called', 'Idle tick, goal already met: clearGoal called'],
  ['stale.cleared', 'Idle tick, goal already met: cleared'],
  ['oneshot.spurious_goal', 'One-step request: recorded as a goal (wrong)'],
]

export function renderSummary(rows, meta = {}) {
  const t = tally(rows)
  const games = Object.keys(t)
  const errs = rows.filter((r) => r?.error).length
  const lines = [
    `# Goal lifecycle eval (text harness)`,
    '',
    `Model ${meta.model ?? '?'}, ${rows.length} runs (${errs} errors), hops/step ${meta.hops ?? '?'}, spend $${(meta.spent ?? 0).toFixed(3)}.`,
    '',
    `| metric | ${games.join(' | ')} |`,
    `|---|${games.map(() => '---').join('|')}|`,
  ]
  for (const [k, label] of ROWS) lines.push(`| ${label} | ${games.map((g) => (t[g][k] ? pct(t[g][k][0], t[g][k][1]) : '-')).join(' | ')} |`)
  const by = games.map((g) => {
    const tot = t[g]['task.cleared_at_end']?.[0] ?? 0
    return `${g}: model ${t[g]['task.cleared_by_model']?.[0] ?? 0}, auto ${t[g]['task.cleared_by_auto']?.[0] ?? 0} of ${tot}`
  })
  const lost = games.map((g) => `${g}: auto ${t[g]['task.lost_by_auto']?.[0] ?? 0}, model ${t[g]['task.lost_by_model']?.[0] ?? 0}`)
  lines.push('', `Who cleared the finished task: ${by.join('; ')}.`, `Who deleted the task goal mid-task: ${lost.join('; ')}.`)
  return lines.join('\n') + '\n'
}
