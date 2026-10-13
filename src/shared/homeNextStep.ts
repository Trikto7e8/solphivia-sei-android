/**
 * The Home "up next" card (261013, retention O2 / T119): shared contract.
 *
 * Main reads each Home character's latest unexpired, unconsumed "Plan for
 * next time" entry from MEMORY.md (written by T80 goodbyes and the T96
 * player-end check), or falls back to its newest active goal from the
 * HEARTBEAT goal files, and answers `home:next-steps` with one of these per
 * character that has something. src/main/homeNextStep.ts has the rules.
 */

/** Where a plan was made. Same values as playerEndNextStep's NextStepSurface. */
export type HomeNextStepSurface = 'game' | 'call' | 'backseat';

export interface HomeNextStep {
  characterId: string;
  /** 'plan' = a saved "Plan for next time"; 'goal' = an active HEARTBEAT goal. */
  source: 'plan' | 'goal';
  /** The step as display text (one line, first letter capitalized). */
  text: string;
  /** When the entry was written, ms epoch. */
  at: number;
  /** The surface it came from; null when not recorded (older plans). */
  surface: HomeNextStepSurface | null;
  /** Game id for surface 'game' (minecraft, stardew, dontstarve) or a backseat game id. */
  game: string | null;
}
