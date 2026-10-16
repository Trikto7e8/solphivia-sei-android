/**
 * 261017 (issue #46): "Continue with ChatGPT", ChatGPT plan usage for the
 * companion through OpenAI's Sign in with ChatGPT open-source flow.
 *
 * Shared constants and pure helpers for main and renderer. The protocol
 * values come from OpenAI's SIWC docs ("Registration and sign-in", "Accounts
 * and sessions", "Models and inference", "UI/UX guidelines"), read 261017.
 * Discovery (`/.well-known/openid-configuration`) overrides the endpoint URLs
 * at runtime when it answers; these are the documented fallbacks.
 *
 * Nothing here is a credential. Tokens live only in main
 * (src/main/chatgptPlan/), encrypted with safeStorage.
 */

export const CHATGPT_ISSUER = 'https://auth.openai.com';
export const CHATGPT_DISCOVERY_URL = 'https://auth.openai.com/.well-known/openid-configuration';
export const CHATGPT_AUTHORIZE_URL = 'https://auth.openai.com/api/accounts/authorize';
export const CHATGPT_TOKEN_URL = 'https://auth.openai.com/api/accounts/oauth/token';
export const CHATGPT_JWKS_URL = 'https://auth.openai.com/.well-known/jwks.json';
/** The `resource` parameter on authorize, code exchange and refresh. */
export const CHATGPT_RESOURCE = 'https://api.openai.com/v1';
export const CHATGPT_API_BASE = 'https://api.openai.com/v1';
export const CHATGPT_RESPONSES_URL = `${CHATGPT_API_BASE}/responses`;
export const CHATGPT_MODELS_URL = `${CHATGPT_API_BASE}/models`;

/** First-time registration entry point. Never saved as an issued client id. */
export const CHATGPT_DYNAMIC_CLIENT_ID = 'dynamic_agent_client';
/** `agent_name_hint`: the app's actual name, the same on every install. */
export const CHATGPT_AGENT_NAME = 'Sei';

/** The scope that authorizes plan usage. Without it the sign-in is identity only. */
export const CHATGPT_PLAN_SCOPE = 'chatgpt.tokens.use.direct';
export const CHATGPT_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'resource.invoke',
  CHATGPT_PLAN_SCOPE,
] as const;

/** Loopback callback: 127.0.0.1 only, path fixed, only the port may vary. */
export const CHATGPT_CALLBACK_HOST = '127.0.0.1';
export const CHATGPT_CALLBACK_PATH = '/auth/callback';
export const CHATGPT_PREFERRED_PORT = 1455;

/** Where users review app usage and limits (UI/UX guidelines). */
export const CHATGPT_USAGE_URL = 'https://chatgpt.com/settings/usage';
/** Where the per-plan "Learn more" link points (UI/UX guidelines). */
export const CHATGPT_HELP_URL = 'https://help.openai.com';

/** Static fallback model when the account catalog cannot be read. */
export const CHATGPT_FALLBACK_MODEL = 'gpt-6-luna';

/** One model from `GET /v1/models` (fields Sei reads; the rest is ignored). */
export interface ChatgptModel {
  slug: string;
  display_name: string;
  /** Reasoning levels the model accepts; empty when it lists none. */
  reasoning_levels: string[];
  default_reasoning_level: string | null;
  /** null when the catalog did not say. */
  accepts_images: boolean | null;
}

/**
 * Parse the catalog body: keep `visibility: "list"` entries in SERVER order
 * (the docs' own filter). Unknown shapes return [] rather than throwing.
 */
export function parseChatgptModels(body: unknown): ChatgptModel[] {
  const list = (body as { models?: unknown })?.models;
  if (!Array.isArray(list)) return [];
  const out: ChatgptModel[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const m = raw as Record<string, unknown>;
    if (m.visibility !== 'list') continue;
    const slug = typeof m.slug === 'string' ? m.slug.trim() : '';
    if (!slug) continue;
    const levels = Array.isArray(m.supported_reasoning_levels)
      ? (m.supported_reasoning_levels as unknown[])
          .map((l) =>
            typeof l === 'string' ? l : typeof (l as { effort?: unknown })?.effort === 'string' ? (l as { effort: string }).effort : null,
          )
          .filter((l): l is string => !!l)
      : [];
    const modalities = Array.isArray(m.input_modalities) ? (m.input_modalities as unknown[]) : null;
    out.push({
      slug,
      display_name: typeof m.display_name === 'string' && m.display_name.trim() ? m.display_name.trim() : slug,
      reasoning_levels: levels,
      default_reasoning_level: typeof m.default_reasoning_level === 'string' ? m.default_reasoning_level : null,
      accepts_images: modalities ? modalities.includes('image') : null,
    });
  }
  return out;
}

/**
 * Default model: a companion turn wants the fast, efficient tier, not the
 * most capable one (latency and the Plus 5-hour limit both favor it). First
 * listed slug that names the efficient tier, else the first listed model.
 */
export function pickDefaultChatgptModel(models: readonly Pick<ChatgptModel, 'slug'>[]): string {
  for (const re of [/luna/i, /mini/i, /nano/i]) {
    const hit = models.find((m) => re.test(m.slug));
    if (hit) return hit.slug;
  }
  return models[0]?.slug ?? CHATGPT_FALLBACK_MODEL;
}

/**
 * Reasoning effort for companion turns: as low as the model allows (every
 * Sei surface is latency-bound). null = send no `reasoning` field (the model
 * listed no levels).
 */
export function pickReasoningEffort(levels: readonly string[]): string | null {
  if (!levels.length) return null;
  for (const want of ['low', 'minimal', 'none']) if (levels.includes(want)) return want;
  return levels[0] ?? null;
}

/** Vision verdict for a ChatGPT-plan model (catalog first, name second). */
export function chatgptModelVision(model: string, catalog?: readonly ChatgptModel[]): 'yes' | 'no' | 'unknown' {
  const hit = catalog?.find((m) => m.slug === model);
  if (hit && hit.accepts_images !== null) return hit.accepts_images ? 'yes' : 'no';
  if (/gpt-[5-9]/i.test(model)) return 'yes';
  return 'unknown';
}

// ─── Status contract (main -> renderer) ───────────────────────────────────

/** One saved registration, safe to show (no tokens). */
export interface ChatgptAccountSummary {
  /** Stable local id (issued client_id + subject). */
  id: string;
  email: string | null;
  /** Distinct label for the account picker (email, or email + suffix when two match). */
  label: string;
  /** True when the token set is present (signed in), false after sign-out. */
  signedIn: boolean;
  /** True when the granted scopes include chatgpt.tokens.use.direct. */
  planEnabled: boolean;
}

export interface ChatgptStatus {
  accounts: ChatgptAccountSummary[];
  activeId: string | null;
  /** The sign-in attempt in flight, if any. */
  signingIn: boolean;
  /** Usage limit reached on the active account: requests are paused. */
  usageLimited: boolean;
  /** Last terminal plan error code (CHATGPT_NOT_ELIGIBLE, ...) or null. */
  blockedCode: string | null;
  /** The first-run "You're using your ChatGPT plan" notice was dismissed. */
  welcomeSeen: boolean;
  /** Model catalog of the active account (empty until read). */
  models: ChatgptModel[];
}

export type ChatgptSignInFailure =
  | 'cancelled'
  | 'denied'
  | 'timeout'
  | 'port_unavailable'
  | 'state_mismatch'
  | 'registration_incomplete'
  | 'client_mismatch'
  | 'account_mismatch'
  | 'exchange_failed'
  | 'id_token_invalid'
  | 'network'
  | 'keychain_unavailable'
  | 'browser_failed';

export type ChatgptSignInResult =
  | { ok: true; status: ChatgptStatus; planEnabled: boolean }
  | { ok: false; reason: ChatgptSignInFailure; message?: string };

export interface ChatgptSignOutResult {
  ok: true;
  /** False when remote revocation could not be confirmed (tell the user). */
  revoked: boolean;
  status: ChatgptStatus;
}

/** Account picker label: the email, disambiguated when two registrations share one. */
export function chatgptAccountLabels(
  accounts: readonly { id: string; email: string | null }[],
): Map<string, string> {
  const out = new Map<string, string>();
  const seen = new Map<string, number>();
  for (const a of accounts) {
    const base = a.email || 'ChatGPT account';
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.set(a.id, n === 1 ? base : `${base} (${n})`);
  }
  return out;
}
