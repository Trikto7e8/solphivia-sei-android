import { describe, it, expect } from 'vitest'
import { normalizeNextStep, nextStepMemoryLine, NEXT_STEP_MAX_CHARS } from './nextStep.js'
import { NEXT_TIME_GREETING } from './prompts.js'

describe('normalizeNextStep', () => {
  it('returns null when the model left the field out', () => {
    expect(normalizeNextStep(undefined)).toBeNull()
    expect(normalizeNextStep(null)).toBeNull()
    expect(normalizeNextStep(42)).toBeNull()
    expect(normalizeNextStep('')).toBeNull()
    expect(normalizeNextStep(' \n\t ')).toBeNull()
  })

  it('collapses whitespace into one line', () => {
    expect(normalizeNextStep('  finish the\n\n cabin   roof ')).toBe('finish the cabin roof')
  })

  it('caps a runaway field at a word boundary', () => {
    const long = 'build '.repeat(100)
    const out = normalizeNextStep(long)
    expect(out.length).toBeLessThanOrEqual(NEXT_STEP_MAX_CHARS)
    expect(out.endsWith('build')).toBe(true)
  })
})

describe('nextStepMemoryLine', () => {
  it('uses the prefix the greeting prompt points at', () => {
    const line = nextStepMemoryLine('finish the roof')
    expect(line).toBe('Plan for next time: finish the roof')
    expect(NEXT_TIME_GREETING).toContain('"Plan for next time"')
  })
})

// 261014: the player-facing line for the Home strip, and the greeting cues.
import { normalizePlayerLine, PLAYER_LINE_HARD_MAX_CHARS } from './nextStep.js'
import { nextTimeGreeting, callGreetingNote, FIRST_CONTACT } from './prompts.js'

describe('normalizePlayerLine', () => {
  it('returns null for a missing or empty line', () => {
    expect(normalizePlayerLine(undefined)).toBeNull()
    expect(normalizePlayerLine(42)).toBeNull()
    expect(normalizePlayerLine('  ')).toBeNull()
    expect(normalizePlayerLine('"tomorrow"')).toBeNull()
  })

  it('cleans quotes, a trailing period, and capitalizes', () => {
    expect(normalizePlayerLine('"tell Sui how the Arrival rewatch went."')).toBe('Tell Sui how the Arrival rewatch went')
  })

  it('drops relative days that go stale', () => {
    expect(normalizePlayerLine('raid the east village for beds tomorrow')).toBe('Raid the east village for beds')
    expect(normalizePlayerLine('Tomorrow, get more wood and finish the roof')).toBe('Get more wood and finish the roof')
    expect(normalizePlayerLine('Get wood by the river tonight and finish the roof')).toBe('Get wood by the river and finish the roof')
    expect(normalizePlayerLine('Plant the second wheat row later today')).toBe('Plant the second wheat row')
    expect(normalizePlayerLine('Mine 2 more diamonds next time')).toBe('Mine 2 more diamonds')
  })

  it('keeps a comma list whole and cuts a long line at a clause break', () => {
    expect(normalizePlayerLine('Gather blaze powder, pufferfish and a brewing stand, then return to the ocean monument for sponges'))
      .toBe('Gather blaze powder, pufferfish and a brewing stand')
    expect(normalizePlayerLine('Gather blaze powder and pufferfish for water breathing potions'))
      .toBe('Gather blaze powder and pufferfish for water breathing potions')
  })

  it('hard-caps a runaway line at a word with an ellipsis', () => {
    const out = normalizePlayerLine('Mine diamonds with Marv at the deep strip mine under the old stone tower by the birch forest past the lava lake')
    expect(out.length).toBeLessThanOrEqual(PLAYER_LINE_HARD_MAX_CHARS + 1)
    expect(out.endsWith('…')).toBe(true)
    expect(out).not.toMatch(/\s(?:the|and)…$/)
  })
})

describe('greeting cues (261014)', () => {
  it('names an open plan and asks for it', () => {
    const cue = nextTimeGreeting('finish the "cabin" roof')
    expect(cue).toContain(`"finish the 'cabin' roof"`)
    expect(cue).toMatch(/main thing your greeting is about/)
    expect(cue).not.toMatch(/[—–]/)
  })

  it('null = none open (no cue); undefined = the soft hint', () => {
    expect(nextTimeGreeting(null)).toBe('')
    expect(nextTimeGreeting(undefined)).toBe(NEXT_TIME_GREETING)
  })

  it('FIRST_CONTACT with a plan drops the escape hatch; with null drops the hint', () => {
    const withPlan = FIRST_CONTACT({ gameName: 'Minecraft', known: true, plan: 'finish the roof' })
    expect(withPlan).toContain('"finish the roof"')
    expect(withPlan).not.toContain('This is only a hint')
    const none = FIRST_CONTACT({ gameName: 'Minecraft', known: true, plan: null })
    expect(none).not.toContain('Plan for next time')
    expect(none).toContain('This is only a hint')
    expect(FIRST_CONTACT({ gameName: 'Minecraft', known: true })).toContain(NEXT_TIME_GREETING)
    expect(FIRST_CONTACT({ gameName: 'Minecraft', known: false, plan: null })).toContain('first time you two have played')
  })

  it('call greeting note: plan cue, never silence, group joiners get none', () => {
    const solo = callGreetingNote({ plan: 'ask how the move went' })
    expect(solo).toContain('"ask how the move went"')
    expect(solo).toContain('never (silence)')
    expect(solo).not.toContain('or just say hi')
    // The cue must not say "the last thing ... said": the call primer's
    // (silence) rule keys on that phrase.
    expect(solo).not.toMatch(/last thing/)
    const none = callGreetingNote({ plan: null })
    expect(none).toContain('or just say hi')
    expect(none).not.toContain('Plan for next time')
    const group = callGreetingNote({ peers: ['Marv'], plan: 'ask how the move went' })
    expect(group).toContain('ongoing group voice call')
    expect(group).not.toContain('move')
  })
})
