// scripts/quality-eval/persona/characters.mjs: load the character fixtures the
// persona eval runs (cloud rows saved read-only under ~/suisei/eval/characters,
// never in the repo). A fixture is either the row object or a one-element
// array, as the Supabase query returned it.
import fs from 'node:fs'
import path from 'node:path'

export const DEFAULT_CHARS = ['sui', 'lyra', 'marv', 'red', 'roger']

// Mirror of effectiveMcUsername (src/shared/characterSchema.ts): the in-game
// name is character.username, else the display name sanitized to MC rules.
function mcName(row) {
  if (row.username) return row.username
  const s = String(row.name ?? '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 16)
  return s.length >= 3 ? s : `${s}_sei`.slice(0, 16)
}

export function loadCharacters(dir, keys = DEFAULT_CHARS) {
  return keys.map((key) => {
    let row = JSON.parse(fs.readFileSync(path.join(dir, `${key}.json`), 'utf8'))
    if (Array.isArray(row)) row = row[0]
    return {
      key,
      id: row.id,
      name: row.name,
      botName: mcName(row),
      expanded: row.persona_expanded,
      source: row.persona_source,
      description: row.metadata?.description ?? null,
      punctuation: row.metadata?.punctuation === 'deliberate' ? 'deliberate' : null,
    }
  })
}
