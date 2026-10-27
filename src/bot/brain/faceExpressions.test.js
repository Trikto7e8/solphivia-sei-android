// 261028 facepack pilot: the expression vocabulary, tag reader and prompt.
import { describe, it, expect } from 'vitest'
import {
  FACE_EXPRESSIONS,
  FACE_EXPRESSION_NAMES,
  FACE_PROMPT,
  FACE_DECAY_MS,
  resolveExpression,
  readFaceTags,
} from './faceExpressions.js'

describe('resolveExpression', () => {
  it('accepts every name', () => {
    for (const n of FACE_EXPRESSION_NAMES) expect(resolveExpression(n)).toBe(n)
    expect(FACE_EXPRESSION_NAMES).toHaveLength(12)
  })
  it('maps aliases, ignoring case and spacing', () => {
    expect(resolveExpression('smirk')).toBe('smug')
    expect(resolveExpression(' Blushing ')).toBe('embarrassed')
    expect(resolveExpression('LOL')).toBe('laugh')
    expect(resolveExpression('hmm')).toBe('thinking')
    expect(resolveExpression('ugh')).toBe('annoyed')
    expect(resolveExpression('gasps')).toBe('surprised')
  })
  it('maps the tags the probe saw invented (worried, relieved, nervous)', () => {
    expect(resolveExpression('worried')).toBe('sad')
    expect(resolveExpression('concerned')).toBe('sad')
    expect(resolveExpression('relieved')).toBe('happy')
    expect(resolveExpression('nervous')).toBe('embarrassed')
  })
  it('no alias collides with another expression name', () => {
    const names = new Set(FACE_EXPRESSION_NAMES)
    for (const e of FACE_EXPRESSIONS) for (const a of e.aliases) expect(names.has(a)).toBe(false)
  })
  it('returns null for unknown, empty and non-string input', () => {
    expect(resolveExpression('flibberflop')).toBeNull()
    expect(resolveExpression('leans in')).toBeNull()
    expect(resolveExpression('')).toBeNull()
    expect(resolveExpression('   ')).toBeNull()
    expect(resolveExpression(null)).toBeNull()
    expect(resolveExpression(3)).toBeNull()
  })
})

describe('readFaceTags', () => {
  it('reads a leading tag', () => {
    expect(readFaceTags('[happy] oh nice, you made it')).toEqual({ lead: 'happy', trail: null })
  })
  it('reads an alias tag', () => {
    expect(readFaceTags('[smirk] told you')).toEqual({ lead: 'smug', trail: null })
  })
  it('keeps the last valid leading tag', () => {
    expect(readFaceTags('[happy] [excited] wait what')).toEqual({ lead: 'excited', trail: null })
  })
  it('a tag after spoken words is the trail', () => {
    expect(readFaceTags('fine. [pout]')).toEqual({ lead: null, trail: 'pout' })
    expect(readFaceTags('[happy] ok sure [smug] whatever')).toEqual({ lead: 'happy', trail: 'smug' })
  })
  it('ignores unknown tags and keeps reading', () => {
    expect(readFaceTags('[leans in] [sad] oh no')).toEqual({ lead: 'sad', trail: null })
    expect(readFaceTags('[flibberflop] hi')).toEqual({ lead: null, trail: null })
  })
  it('no tag, empty and non-string input', () => {
    expect(readFaceTags('plain line')).toEqual({ lead: null, trail: null })
    expect(readFaceTags('')).toEqual({ lead: null, trail: null })
    expect(readFaceTags(undefined)).toEqual({ lead: null, trail: null })
  })
  it('is case-insensitive and tolerates inner spaces', () => {
    expect(readFaceTags('[ Surprised ] whoa')).toEqual({ lead: 'surprised', trail: null })
  })
  it('does not read markdown links or numbers as tags', () => {
    expect(readFaceTags('see [1] and [happy](x)')).toEqual({ lead: null, trail: 'happy' })
  })
})

describe('FACE_PROMPT', () => {
  it('lists every expression in brackets and says the bracket is not spoken', () => {
    for (const n of FACE_EXPRESSION_NAMES) expect(FACE_PROMPT).toContain(`[${n}]`)
    expect(FACE_PROMPT).toMatch(/not spoken or shown/)
  })
  it('has no em dash (prompt-writing style)', () => {
    expect(FACE_PROMPT).not.toContain('—')
    expect(FACE_PROMPT).toMatch(/Start each reply with/)
  })
  it('decay holds only on the four strong expressions', () => {
    expect(Object.keys(FACE_DECAY_MS).sort()).toEqual(['embarrassed', 'excited', 'laugh', 'surprised'])
  })
  it('laugh never blinks (eyes already squeezed shut)', () => {
    expect(FACE_EXPRESSIONS.find((e) => e.name === 'laugh').blink).toBe(false)
  })
})
