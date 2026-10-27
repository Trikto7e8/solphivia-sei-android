/**
 * Face expressions for the desktop companion (261028, facepack pilot).
 *
 * ONE closed vocabulary shared by every process: main reads a leading
 * `[expression]` tag off chat and call lines (chatService splitReplyParts),
 * the bot offers it as the optional `expression` parameter of say(), and the
 * renderer drives FacepackView with it. Plain JS so the bot (raw ESM in the
 * utilityProcess) can import it; faceExpressions.d.ts types it for main and
 * the renderer.
 *
 * Source of truth for names, descriptions, aliases and blink flags is the
 * face-set bake's expressions.json (~/suisei/work/face-sets, 2026-10-27),
 * plus four aliases the tag probe saw Haiku invent (261028): worried and
 * concerned -> sad, relieved -> happy, nervous -> embarrassed.
 * Each baked pack also carries its own per-expression `blink` flag, which is
 * what the player actually reads; the copy here is informational.
 *
 * Production safety: nothing here is active unless the facepack dev flag is
 * on (main/facepack/facepackDev.ts). The parser is read-only: it never edits
 * the line, because stripAudioTags already removes every bracket tag of this
 * shape before a line is shown or spoken.
 */

/** @type {ReadonlyArray<{name: string, description: string, aliases: string[], blink: boolean}>} */
export const FACE_EXPRESSIONS = Object.freeze([
  { name: 'neutral', description: 'Calm, attentive default. Ordinary talk, listening, explaining.', aliases: ['calm', 'default', 'normal', 'listening'], blink: true },
  { name: 'happy', description: 'Warm smile. Pleased, friendly, agreeing, glad to see them.', aliases: ['smile', 'glad', 'pleased', 'warm', 'giggles', 'relieved'], blink: true },
  { name: 'laugh', description: 'Eyes squeezed shut, big open grin. Something is genuinely funny.', aliases: ['laughing', 'lol', 'laughs', 'snorts'], blink: false },
  { name: 'excited', description: "Wide bright eyes, open smile. Hyped, eager, can't wait, big news.", aliases: ['hyped', 'eager', 'thrilled', 'delighted'], blink: true },
  { name: 'smug', description: 'Half-lidded eyes, one-sided smirk. Teasing, told-you-so, playful mischief.', aliases: ['smirk', 'teasing', 'mischievous', 'proud', 'cocky'], blink: true },
  { name: 'pout', description: 'Pursed lips, brows knit. Mock-offended, sulking, playful protest.', aliases: ['sulk', 'hmph', 'huff', 'pouting'], blink: true },
  { name: 'sad', description: 'Brows tilted up in the middle, mouth down. Disappointed, sympathetic, hurt.', aliases: ['upset', 'disappointed', 'sorry', 'hurt', 'sighs', 'worried', 'concerned'], blink: true },
  { name: 'surprised', description: 'Eyes wide, brows high, small open mouth. Caught off guard, shocked, wait what.', aliases: ['shocked', 'shock', 'gasp', 'gasps', 'wow'], blink: true },
  { name: 'embarrassed', description: 'Blushing, eyes darting away, wobbly mouth. Complimented, flustered, caught out, shy.', aliases: ['blush', 'blushing', 'flustered', 'shy', 'awkward', 'nervous'], blink: true },
  { name: 'thinking', description: 'Glancing up and aside, mouth pressed. Considering, unsure, trying to remember.', aliases: ['hmm', 'pondering', 'unsure', 'curious', 'confused'], blink: true },
  { name: 'sleepy', description: 'Heavy lids, slack calm face. Tired, late at night, winding down, cozy.', aliases: ['tired', 'drowsy', 'yawn', 'exhales'], blink: true },
  { name: 'annoyed', description: 'Brows down, narrowed eyes, flat frown. Irritated, grumpy, mock anger.', aliases: ['angry', 'irritated', 'grumpy', 'mad', 'ugh'], blink: true },
]);

/** The 12 names, in vocabulary order (the say() enum and the prompt list). */
export const FACE_EXPRESSION_NAMES = Object.freeze(FACE_EXPRESSIONS.map((e) => e.name));

/** The resting face every strong expression decays back to. */
export const FACE_NEUTRAL = 'neutral';

/**
 * Strong expressions decay to neutral after the line ends plus this hold
 * (EXPRESSIONS_SPEC.md). Every other expression persists until the next tag.
 */
export const FACE_DECAY_MS = Object.freeze({
  laugh: 1_500,
  surprised: 2_000,
  excited: 4_000,
  embarrassed: 6_000,
});

/** After this long with no speech the face falls back to neutral. */
export const FACE_IDLE_NEUTRAL_MS = 60_000;

const BY_WORD = new Map();
for (const e of FACE_EXPRESSIONS) BY_WORD.set(e.name, e.name);
// Names win over aliases: set aliases only where the word is still free.
for (const e of FACE_EXPRESSIONS) for (const a of e.aliases) if (!BY_WORD.has(a)) BY_WORD.set(a, e.name);

/**
 * Map a tag body or a say() `expression` value onto a vocabulary name.
 * Case and surrounding whitespace are ignored; inner runs of whitespace
 * collapse. Unknown, empty or non-string input returns null ("keep the
 * current face").
 * @param {unknown} word
 * @returns {string | null}
 */
export function resolveExpression(word) {
  if (typeof word !== 'string') return null;
  const key = word.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!key) return null;
  return BY_WORD.get(key) ?? null;
}

/** Same shape as audioTags.ts TAG_RE: one to three plain words in brackets. */
const TAG_RE = /\[[ ]*([a-z]+(?:[ ]+[a-z]+){0,2})[ ]*\]/gi;
const SPOKEN_RE = /[\p{L}\p{N}]/u;

/**
 * Read the face cues in one line (a chat bubble, or one spoken sentence on a
 * call). Read-only: the caller strips the tags as before.
 *
 *  - `lead`: the last valid tag before the first spoken word. Applies when
 *    this line starts (its TTS clip becomes audible, or on arrival in text).
 *  - `trail`: the last valid tag after spoken words. Applies at the end of
 *    this line, i.e. the next clip boundary.
 *
 * Unknown tags (`[leans in]`, `[flibberflop]`) are ignored for the face.
 * @param {unknown} line
 * @returns {{ lead: string | null, trail: string | null }}
 */
export function readFaceTags(line) {
  const text = String(line ?? '');
  let lead = null;
  let trail = null;
  let spoken = false;
  let cursor = 0;
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(text)) !== null) {
    if (!spoken && SPOKEN_RE.test(text.slice(cursor, m.index))) spoken = true;
    cursor = m.index + m[0].length;
    const name = resolveExpression(m[1]);
    if (!name) continue;
    if (spoken) trail = name;
    else lead = name;
  }
  return { lead, trail };
}

/**
 * The FACE block for the chat and voice-call prompts (persona block), only
 * while the facepack dev flag is on. Picked by scripts/facepack-tag-probe.ts
 * (Haiku 5.5, Sui/Lyra/Marv, 30 chat + 33 call turns per run, 261028).
 * The first wording ("only add one when your mood actually shifts") got a
 * leading tag on 50% of chat and 58% of call replies; this one gets 87% and
 * 85% at the same judged fit, with no tag ever reaching the visible text.
 */
export const FACE_PROMPT =
  '# FACE\n' +
  'People can see your face while you talk. Start each reply with the face that matches how you feel as you say it, in square brackets: ' +
  FACE_EXPRESSION_NAMES.map((n) => `[${n}]`).join(' ') +
  '. If your mood changes partway through, put the new one before that sentence. The bracket is not spoken or shown.';

/** say() `expression` parameter description (game surface). */
export const SAY_EXPRESSION_DESCRIPTION = 'Your face while you say this. Omit to keep the current one.';
