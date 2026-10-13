import { describe, it, expect } from 'vitest'
import { groupTurns, repeatedOwnTerms, ownRepeatsNote, recentOwnTurns, repeatedOwnPhrases, repeatedOpener } from './ownRepeats.js'

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

  it('never names the player or a teammate, alone or inside a phrase', () => {
    const lines = session([
      'sorry alex nya, lyra has the wood',
      'thank you alex nya. lyra, come help',
      'ok alex nya, lyra is on it',
    ])
    // Given names (player display name, teammate roster).
    expect(repeatedOwnTerms(lines, [], { names: ['Alex', 'Lyra'] }).map((h) => h.term)).toEqual(['nya'])
    // A speaker in the recent chat counts as a name even when not passed in,
    // and a username's parts count ("Alex_2" -> alex).
    expect(repeatedOwnTerms(lines, [{ who: 'Alex_2', text: 'hi' }, { who: 'Lyra', text: 'on my way' }])
      .map((h) => h.term)).toEqual(['nya'])
    // Without names, the player's name is what gets named (the eval failure).
    expect(repeatedOwnTerms(lines).some((h) => h.term.split(' ').includes('alex'))).toBe(true)
  })

  // A real Minecraft snapshot (persona eval, 261012) plus goals: item, block
  // and task words in it are never named; a tic that is not in it still is.
  const SNAPSHOT = [
    'world: #1 Meadow', 'pos: 112,71,-40', 'facing: north. forward -z, back +z, left -x, right +x',
    'biome: plains  surroundings: outside  light: sky 15 block 0  time: day (2400)',
    'hp: 20/20  food: 18/20  xp: lvl 2', 'holding: stone_pickaxe',
    'inventory (6/36 slots): oak_log×7, cobblestone×23, stone_pickaxe×1, bread×3, torch×6, crafting_table×1',
    'nearby blocks:', '#1 grass_block x412 @111,70,-40', '#2 oak_log x14 @118,72-47', '#3 water x30 @104,70,-52',
    'nearby entities:', '#4 Alex @109,71,-38', '#5 cow @121,71,-31', 'owner Alex: @109,71,-38 (3 blocks away)',
  ].join('\n')
  const GOALS = '- [2026-10-12 21:30] gather wood for a house\n- [2026-10-12 21:31] chop the tree by the lake'
  const ctx = { context: [SNAPSHOT, GOALS] }

  it('never names an item, block or task word from the snapshot or goals', () => {
    const lines = session([
      'got the stone, pickaxe next. zero wood though, trees are far',
      'more stone. this pickaxe is slow. still zero wood, trees everywhere',
      'stone pile growing, pickaxe holding up. zero wood, gotta hit the trees',
    ])
    const terms = repeatedOwnTerms(lines, [], ctx).map((h) => h.term)
    for (const t of ['stone', 'pickaxe', 'zero wood', 'trees']) expect(terms).not.toContain(t)
    expect(terms).toEqual([])
    // Without the context these are exactly what gets named.
    expect(repeatedOwnTerms(lines, [], { max: 10 }).map((h) => h.term)).toEqual(expect.arrayContaining(['stone', 'pickaxe', 'zero wood']))
  })

  it('still names a real tic beside a busy snapshot', () => {
    const lyra = session(['got the logs nya', 'here is the stone nya', 'torches are up nya'])
    expect(repeatedOwnTerms(lyra, [], ctx).map((h) => h.term)).toEqual(['nya'])
    const roger = session(['ok big brother!', 'the cow ran, big brother', 'big brother, the water is cold'])
    expect(repeatedOwnTerms(roger, [], ctx).map((h) => h.term)).toEqual(['big brother'])
    const sui = session(['nehehe stone time', 'nehehe got it', 'wood? nehehe later'])
    expect(repeatedOwnTerms(sui, [], ctx).map((h) => h.term)).toEqual(['nehehe'])
  })

  it('matches plurals both ways, against the player too', () => {
    const lines = session(['more logs', 'logs logs', 'stacking logs'])
    expect(repeatedOwnTerms(lines, [{ text: 'grab a log' }])).toEqual([])
    expect(repeatedOwnTerms(lines, [], { context: ['oak_log x3'] })).toEqual([])
    const torches = session(['torches up', 'two torches', 'torches everywhere'])
    expect(repeatedOwnTerms(torches, [], { context: ['torch×6'] })).toEqual([])
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

  it('passes names through', () => {
    const lines = session(['hey alex', 'alex look', 'nice one alex'])
    expect(ownRepeatsNote(lines, [], { names: ['Alex'] })).toBeNull()
  })

  it('is null when nothing repeats', () => {
    expect(ownRepeatsNote(session(['hey', 'zombie!', 'got the logs']))).toBeNull()
    expect(ownRepeatsNote([])).toBeNull()
    expect(ownRepeatsNote(undefined)).toBeNull()
  })
})

// 261013: line-level repeats. session() starts at 1_000_000 with turns 5 s
// apart, so "now" just after the last turn keeps every line fresh.
const nowAfter = (n, start = 1_000_000) => start + n * 5000 + 1000

describe('recentOwnTurns', () => {
  it('returns her last two turns while they are fresh', () => {
    const lines = session(['one', ['two', 'still two'], 'three'])
    expect(recentOwnTurns(lines, { now: nowAfter(3) }).map((t) => t.text)).toEqual(['two still two', 'three'])
    expect(recentOwnTurns(lines, { now: nowAfter(3) + 10 * 60_000 })).toEqual([])
  })
})

describe('repeatedOwnPhrases', () => {
  const opts = (n, extra = {}) => ({ now: nowAfter(n), ...extra })

  it('names a bit she has used twice, once, in its longest form', () => {
    const lines = session([
      "ok stopping, you're the boss of the wood pile now",
      'trees are over there',
      "ok fine, you're the boss of the wood pile",
    ])
    const hits = repeatedOwnPhrases(lines, [], opts(3))
    expect(hits.map((h) => h.phrase)).toEqual(['boss of the wood pile'])
    expect(hits[0].count).toBe(2)
  })

  it('leaves out the task she is on', () => {
    const lines = session(['need stone, pickaxe next', 'mining stone now, need stone', 'pickaxe next, then stone'])
    expect(repeatedOwnPhrases(lines, [], opts(3, { context: ['stone_pickaxe×1, cobblestone×3'] }))).toEqual([])
  })

  it('leaves out names and what the player also said', () => {
    const named = session(['nice one alex smith', 'good job alex smith'])
    expect(repeatedOwnPhrases(named, [], opts(2, { names: ['Alex Smith'] }))).toEqual([])
    const echoed = session(['you owe me a snack', 'fine, you owe me a snack'])
    expect(repeatedOwnPhrases(echoed, [{ who: 'Alex', text: 'i owe you a snack? you owe me a snack' }], opts(2))).toEqual([])
    expect(repeatedOwnPhrases(echoed, [], opts(2)).map((h) => h.phrase)).toEqual(['owe me a snack'])
  })

  it('ignores old turns', () => {
    const lines = session(['you owe me a snack', 'fine, you owe me a snack'])
    expect(repeatedOwnPhrases(lines, [], opts(2, { now: nowAfter(2) + 10 * 60_000 }))).toEqual([])
  })
})

describe('repeatedOpener', () => {
  it('finds an opener she keeps using, never a plain word or a name', () => {
    expect(repeatedOpener(session(['ok stopping', 'ok fine', 'wood next']), { now: nowAfter(3) })).toBe('ok')
    expect(repeatedOpener(session(["i'm here", "i'm going", 'i got it']), { now: nowAfter(3) })).toBeNull()
    expect(repeatedOpener(session(['alex look', 'alex wait']), { now: nowAfter(2), names: ['Alex'] })).toBeNull()
  })
})

describe('ownRepeatsNote, line level', () => {
  it('quotes her last lines, names the bit and the opener, in plain text', () => {
    const lines = session([
      "ok stopping, you're the boss of the wood pile now",
      'ok so trees are over there',
    ])
    const note = ownRepeatsNote(lines, [], { now: nowAfter(2) })
    expect(note).toContain(`"ok stopping, you're the boss of the wood pile now" and then "ok so trees are over there"`)
    expect(note).toContain('keep starting with "ok"')
    expect(note).not.toMatch(/[—–]/)
    const again = session([...["ok stopping, you're the boss of the wood pile now", 'trees are over there'], "fine, you're the boss of the wood pile"])
    expect(ownRepeatsNote(again, [], { now: nowAfter(3) })).toContain('"boss of the wood pile" more than once')
  })

  it('does not name a tic phrase twice', () => {
    const roger = session(['ok big brother!', 'the cow ran, big brother', 'big brother, the water is cold'])
    const note = ownRepeatsNote(roger, [], { now: nowAfter(3) })
    expect(note.match(/"big brother"/g)).toHaveLength(1)
  })

  it('is null when her lines are old and nothing repeats', () => {
    expect(ownRepeatsNote(session(['hey', 'zombie!']), [], { now: nowAfter(2) + 10 * 60_000 })).toBeNull()
  })
})
