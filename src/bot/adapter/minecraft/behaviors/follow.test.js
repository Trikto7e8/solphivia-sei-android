import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import { followMovements, followSprintFor, FOLLOW_SPRINT_ON_DIST, FOLLOW_SPRINT_OFF_DIST } from './follow.js'

const require = createRequire(import.meta.url)
const mcData = require('minecraft-data')('1.21.1')

describe('follow movements (261011)', () => {
  it('trails at a walk by default, keeping the default dig cost', () => {
    const m = followMovements({ registry: mcData })
    expect(m.allowSprinting).toBe(false)
    expect(m.digCost).toBe(1)
  })

  it('sprints to catch up when far behind and walks again once close', () => {
    expect(followSprintFor(FOLLOW_SPRINT_ON_DIST + 1, false)).toBe(true)
    // Between the two thresholds it keeps what it was doing (no flapping).
    expect(followSprintFor(8, true)).toBe(true)
    expect(followSprintFor(8, false)).toBe(false)
    expect(followSprintFor(FOLLOW_SPRINT_OFF_DIST - 1, true)).toBe(false)
  })
})
