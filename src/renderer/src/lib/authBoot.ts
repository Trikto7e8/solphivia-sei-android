/**
 * 261029 (login lock on restart): read main's auth state on demand instead of
 * trusting the renderer's default and whatever pushes happened to land.
 *
 * The store starts at `local` and only learns better from `auth:state` pushes,
 * and the onboarding sign-in panel only moves on once an `app:scope-changed`
 * push says the account's profile is live. A push sent before a listener
 * existed is gone, so a panel mounted late could wait for a push that had
 * already happened (or would never come, when the scope was right all along).
 * `sei.authSnapshot()` answers both questions at once.
 */
import { sei } from './ipcClient';
import type { AuthSnapshot } from '@shared/ipc';

/** How long the boot routing waits for a scope switch already under way. */
export const SCOPE_READY_WAIT_MS = 10_000;
const SCOPE_READY_POLL_MS = 300;

function isSnapshot(v: unknown): v is AuthSnapshot {
  if (!v || typeof v !== 'object') return false;
  const s = (v as { state?: { kind?: unknown } }).state;
  return !!s && (s.kind === 'local' || s.kind === 'signed_in') && typeof (v as { scopeReady?: unknown }).scopeReady === 'boolean';
}

/** Main's snapshot, or null when the bridge lacks it (tests, stubs) or the call failed. */
export async function readAuthSnapshot(): Promise<AuthSnapshot | null> {
  try {
    const fn = (sei as Partial<typeof sei> | undefined)?.authSnapshot;
    if (typeof fn !== 'function') return null;
    const snap: unknown = await fn();
    return isSnapshot(snap) ? snap : null;
  } catch {
    return null;
  }
}

/**
 * The snapshot once the data scope follows the auth state, polling while a
 * switch is under way (bounded). `waited` says a switch was in flight when the
 * first read came back, so anything read from the profile before it is stale.
 */
export async function waitForAuthScope(
  opts: { timeoutMs?: number; isCancelled?: () => boolean; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ snapshot: AuthSnapshot | null; waited: boolean }> {
  const timeoutMs = opts.timeoutMs ?? SCOPE_READY_WAIT_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let snapshot = await readAuthSnapshot();
  let waited = false;
  // Main gave up waiting for its own session load: nothing to wait for here,
  // route on what there is (the pushes correct it later).
  if (snapshot && snapshot.loaded === false) return { snapshot, waited };
  let polls = Math.ceil(timeoutMs / SCOPE_READY_POLL_MS);
  while (snapshot && !snapshot.scopeReady && polls-- > 0 && !opts.isCancelled?.()) {
    waited = true;
    await sleep(SCOPE_READY_POLL_MS);
    snapshot = (await readAuthSnapshot()) ?? snapshot;
  }
  return { snapshot, waited };
}
