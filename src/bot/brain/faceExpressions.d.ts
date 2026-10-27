// Types for src/bot/brain/faceExpressions.js (imported by main and the renderer).
export interface FaceExpressionDef {
  name: string;
  description: string;
  aliases: string[];
  blink: boolean;
}
export const FACE_EXPRESSIONS: ReadonlyArray<FaceExpressionDef>;
export const FACE_EXPRESSION_NAMES: ReadonlyArray<string>;
export const FACE_NEUTRAL: 'neutral';
export const FACE_DECAY_MS: Readonly<Record<string, number>>;
export const FACE_IDLE_NEUTRAL_MS: number;
export function resolveExpression(word: unknown): string | null;
export function readFaceTags(line: unknown): { lead: string | null; trail: string | null };
export const FACE_PROMPT: string;
export const SAY_EXPRESSION_DESCRIPTION: string;
