import { describe, it, expect } from 'vitest'
import { groupTurns, repeatedOwnTerms, ownRepeatsNote } from './ownRepeats.js'

// One say() line is recorded as several chat messages within a few ms; turns
// are seconds apart.
function session(turns, start = 1_000_000) {
  const out = []
  turns.forEach((msgs, i) => {
    const at = start + i * 5000
    ;(Array.isArray(msgs) ? msgs : [msgs]).forEach((text, j) => out.push({ at: at + j, text }))
  })
  return out
}

describe('groupTurns', () => {
  it('joins the messages of one say() line and splits separate turns', () => {
    const t = groupTurns(session([['oh!', "you're back nya..."], 'a zombie nya']))
    expect(t.map((x) => x.text)).toEqual(["oh! you're back nya...", 'a zombie nya'])
  })
})

describe('repeatedOwnTerms', () => {
  it('finds a line-ending tic used in most recent turns', () => {
    const lines = session([
      "alex! you're back nya",
      'thank you nya. i just wanted to help',
      "i-i'm okay nya, just took some arrows",
      "a zombie! i'll fight it nya",
    ])
    const hits = repeatedOwnTerms(lines)
    expect(hits[0]).toMatchObject({ term: 'nya', count: 4, of: 4 })
  })

  it('names a pet-name phrase once, not its words separately', () => {
    const lines = session([
      'Really? Thank you, big brother...',
      'Zombie! I got it, big brother, stay back!',
      'Okay big brother! I will get the logs.',
    ])
    expect(repeatedOwnTerms(lines).map((h) => h.term)).toEqual(['big brother'])
  })

  it('leaves out a topic the player is also talking about', () => {
    const lines = session(['ok more wood coming', 'wood is stacking up', 'last of the wood'])
    expect(repeatedOwnTerms(lines, [{ text: 'can you get wood for the house' }])).toEqual([])
    expect(repeatedOwnTerms(lines).map((h) => h.term)).toEqual(['wood'])
  })

  it('needs at least three turns and ignores grammar words', () => {
    expect(repeatedOwnTerms(session(['nya', 'nya']))).toEqual([])
    expect(repeatedOwnTerms(session(['it is you', 'you and it', 'is it you']))).toEqual([])
  })

  it('only looks at the last few turns', () => {
    const lines = session(['the sun is up', 'the sun again', 'the sun, always', 'hi', 'ok going', 'fine'])
    expect(repeatedOwnTerms(lines)).toEqual([])
  })
})

describe('ownRepeatsNote', () => {
  it('quotes the repeated term with its count', () => {
    const note = ownRepeatsNote(session(['the universe is cooling', 'lava. the universe again', 'the universe, of course']))
    expect(note).toContain('"the universe"')
    expect(note).toContain('3 of your last 3')
    expect(note).not.toMatch(/[—–]/)
  })

  it('is null when nothing repeats', () => {
    expect(ownRepeatsNote(session(['hey', 'zombie!', 'got the logs']))).toBeNull()
    expect(ownRepeatsNote([])).toBeNull()
    expect(ownRepeatsNote(undefined)).toBeNull()
  })
})
