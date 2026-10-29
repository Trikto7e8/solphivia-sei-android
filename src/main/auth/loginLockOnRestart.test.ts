/**
 * Regression: "sometimes when I restart the app it locks me in the login page
 * and won't let me enter with my account" (Discord, 261028).
 *
 * Drives the REAL supabase-js client (fake GoTrue over a stub fetch, in-memory
 * storage) through main's boot order:
 *
 *   0a. getSession() -> setActiveScope(user ?? local)      (index.ts)
 *   5b. initAuthState(window)                               (authState.ts)
 *   ... user signs in again on the sign-in panel
 *
 * After a restart the persisted access token has expired, so BOTH getSession
 * calls refresh over the network. When the first refresh fails transiently
 * (offline for a moment at launch, a 502/503/504) and the second succeeds,
 * main used to end up signed in as the user while the data scope stayed
 * 'local', and nothing ever reconciled the two: no app:scope-changed push, so
 * the onboarding sign-in panel waited forever, and signing in again was a
 * same-user SIGNED_IN that main treated as "nothing changed".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ---- profile scope: real paths module, spied switch ------------------------
vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/tmp' } }));
const switchScopeMock = vi.fn();
vi.mock('../profile/profileScope', () => ({
  switchScopeForAuth: (...a: unknown[]) => switchScopeMock(...a),
}));
// Side effects of a sign-in transition: no-ops here.
vi.mock('../apiKeyStore', () => ({ applyCloudDefaultForSignIn: vi.fn(async () => {}) }));
vi.mock('../cloud/reconcileLocalOwnership', () => ({ reconcileLocalOwnershipOnSignIn: vi.fn(async () => {}) }));
vi.mock('../ipc', () => ({ remoderateResetSharedCharactersOnSignIn: vi.fn(async () => {}) }));
vi.mock('../configStore', () => ({ loadConfig: vi.fn(async () => ({})) }));
vi.mock('../cloud/cloudCharacterClient', () => ({ upsertMyProfile: vi.fn(async () => {}) }));
vi.mock('../analytics', () => ({ identifyUser: vi.fn(), capture: vi.fn(), resetUser: vi.fn() }));
vi.mock('../cloud/librarySync', () => ({ syncLibraryRoster: vi.fn(async () => {}) }));
vi.mock('./tosGate', () => ({ getTosAcceptance: vi.fn(async () => 'accepted') }));

let client: SupabaseClient;
vi.mock('./supabaseClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./supabaseClient')>()),
  getClient: () => client,
}));

import { setActiveScope, getActiveScope } from '../paths';
import { capture } from '../analytics';
import {
  initAuthState,
  getCurrentAuthState,
  getAuthSnapshot,
  transitionToLocal,
  _disposeForTests,
  _scopeSwitchSettledForTests,
} from './authState';
import { persistedSessionUserId } from './supabaseClient';

const URL_BASE = 'https://proj.supabase.co';
const STORAGE_KEY = 'sb-proj-auth-token';
const USER_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

function fakeJwt(exp: number): string {
  const b64 = (o: object): string => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER_ID, exp, role: 'authenticated' })}.sig`;
}

const user = {
  id: USER_ID,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'player@example.com',
  email_confirmed_at: '2026-05-01T00:00:00Z',
  created_at: '2026-05-01T00:00:00Z',
  app_metadata: {},
  user_metadata: {},
};

function sessionBody(nowSec: number, n: number): Record<string, unknown> {
  return {
    access_token: fakeJwt(nowSec + 3600),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: nowSec + 3600,
    refresh_token: `rt-${n}`,
    user,
  };
}

/** Stub GoTrue. `networkDown` makes every request fail like an offline fetch. */
interface FakeServer {
  networkDown: boolean;
  refreshCalls: number;
  fetch: typeof fetch;
}
function fakeServer(): FakeServer {
  const s: FakeServer = {
    networkDown: false,
    refreshCalls: 0,
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (s.networkDown) {
        // An offline refresh: a retryable fetch error. Skew the clock past the
        // retry window so supabase-js gives up at once instead of sleeping.
        clockSkewMs += 31_000;
        throw new TypeError('fetch failed');
      }
      const now = Math.floor(Date.now() / 1000);
      const json = (body: unknown, status = 200): Response =>
        new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (url.includes('grant_type=refresh_token')) {
        s.refreshCalls += 1;
        return json(sessionBody(now, 100 + s.refreshCalls));
      }
      if (url.includes('grant_type=password')) return json(sessionBody(now, 999));
      if (url.endsWith('/auth/v1/user')) return json(user);
      return json({ msg: 'not found' }, 404);
    }) as typeof fetch,
  };
  return s;
}

let clockSkewMs = 0;
const realNow = Date.now.bind(Date);

function memoryStorage(seed: Record<string, string>): {
  getItem(k: string): Promise<string | null>;
  setItem(k: string, v: string): Promise<void>;
  removeItem(k: string): Promise<void>;
} {
  const m = new Map(Object.entries(seed));
  return {
    getItem: async (k) => m.get(k) ?? null,
    setItem: async (k, v) => void m.set(k, v),
    removeItem: async (k) => void m.delete(k),
  };
}

function fakeWindow(): { win: Electron.BrowserWindow; sent: Array<[string, unknown]> } {
  const sent: Array<[string, unknown]> = [];
  const win = {
    isDestroyed: () => false,
    webContents: {
      send: (ch: string, payload: unknown) => sent.push([ch, payload]),
      on: () => {},
      removeListener: () => {},
    },
  } as unknown as Electron.BrowserWindow;
  return { win, sent };
}

/** The persisted session from the previous run: its access token expired an hour ago. */
function expiredPersistedSession(): Record<string, string> {
  const past = Math.floor(realNow() / 1000) - 3600;
  return {
    [STORAGE_KEY]: JSON.stringify({ ...sessionBody(past - 3600, 1), expires_at: past }),
  };
}

async function bootScopeLikeIndexTs(): Promise<void> {
  const { data: { session } } = await client.auth.getSession();
  setActiveScope(session?.user?.id ?? null);
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  clockSkewMs = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => realNow() + clockSkewMs);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  switchScopeMock.mockReset().mockImplementation(async (id: string | null) => setActiveScope(id));
  vi.mocked(capture).mockClear();
  setActiveScope('local');
});

afterEach(() => {
  _disposeForTests();
  vi.restoreAllMocks();
  setActiveScope('local');
});

let storage: ReturnType<typeof memoryStorage>;
function makeClient(server: FakeServer): SupabaseClient {
  storage = memoryStorage(expiredPersistedSession());
  return createClient(URL_BASE, 'sb_publishable_test', {
    auth: {
      storage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
    global: { fetch: server.fetch },
  });
}

describe('restart with an expired access token', () => {
  it('the boot scope and the auth state agree when the first refresh fails and the second succeeds', async () => {
    const server = fakeServer();
    server.networkDown = true;
    client = makeClient(server);

    await bootScopeLikeIndexTs();
    expect(getActiveScope()).toBe('local'); // offline at step 0a

    server.networkDown = false; // network is back by step 5b
    const { win } = fakeWindow();
    await initAuthState(win);
    await flush();

    const state = getCurrentAuthState();
    expect(state.kind).toBe('signed_in');
    // The data scope must follow the restored account, as a restore (no
    // sign-in analytics, no import offer on the renderer side).
    expect(getActiveScope()).toBe(USER_ID);
    expect(switchScopeMock).toHaveBeenCalledWith(USER_ID, { restored: true });
    expect(capture).not.toHaveBeenCalledWith('signed_in');
    expect(await getAuthSnapshot()).toEqual({ state, scopeReady: true, loaded: true });
  });

  it('signing in again on the sign-in panel moves the scope when it is stale', async () => {
    const server = fakeServer();
    server.networkDown = true;
    client = makeClient(server);
    await bootScopeLikeIndexTs();
    server.networkDown = false;
    const { win } = fakeWindow();
    await initAuthState(win);
    await flush();
    // Simulate the pre-fix world where init did not reconcile.
    setActiveScope('local');
    switchScopeMock.mockClear();

    const { error } = await client.auth.signInWithPassword({ email: 'player@example.com', password: 'pw' });
    expect(error).toBeNull();
    await flush();
    expect(switchScopeMock).toHaveBeenCalledWith(USER_ID, { restored: false });
    expect(getActiveScope()).toBe(USER_ID);
    expect(capture).toHaveBeenCalledWith('signed_in');
  });

  it('the boot scope read finds the account offline, where getSession() does not', async () => {
    const server = fakeServer();
    server.networkDown = true;
    client = makeClient(server);
    // What step 0a used to do: the refresh fails, no session.
    const { data } = await client.auth.getSession();
    expect(data.session).toBeNull();
    // What it does now: the stored session's account, no refresh involved.
    expect(await persistedSessionUserId({ client, storage })).toBe(USER_ID);
    // Nothing stored: local.
    expect(await persistedSessionUserId({ client, storage: memoryStorage({}) })).toBeNull();
  });

  it('a snapshot reports the scope not ready while the switch runs, then ready', async () => {
    const server = fakeServer();
    server.networkDown = true;
    client = makeClient(server);
    await bootScopeLikeIndexTs();
    server.networkDown = false;
    let release: () => void = () => {};
    switchScopeMock.mockImplementation(
      (id: string | null) =>
        new Promise<void>((r) => {
          release = () => {
            setActiveScope(id);
            r();
          };
        }),
    );
    const { win } = fakeWindow();
    await initAuthState(win);
    await flush();
    const during = await getAuthSnapshot();
    expect(during.state.kind).toBe('signed_in');
    expect(during.scopeReady).toBe(false);
    release();
    await _scopeSwitchSettledForTests();
    expect((await getAuthSnapshot()).scopeReady).toBe(true);
  });

  it('offline through both reads: the later token refresh moves the scope', async () => {
    const server = fakeServer();
    server.networkDown = true;
    client = makeClient(server);
    await bootScopeLikeIndexTs();
    const { win } = fakeWindow();
    await initAuthState(win);
    await flush();
    expect(getCurrentAuthState().kind).toBe('local');
    expect(switchScopeMock).not.toHaveBeenCalled();
    // The auto-refresh tick once the network is back (called directly here).
    server.networkDown = false;
    const { error } = await client.auth.refreshSession();
    expect(error).toBeNull();
    await flush();
    await _scopeSwitchSettledForTests();
    expect(getCurrentAuthState().kind).toBe('signed_in');
    expect(getActiveScope()).toBe(USER_ID);
    expect(switchScopeMock).toHaveBeenCalledWith(USER_ID, { restored: true });
  });
});

describe('auth snapshot before the session load', () => {
  it('answers on its time bound as not loaded, never as a ready local state', async () => {
    const snap = await getAuthSnapshot(5);
    expect(snap).toEqual({ state: { kind: 'local' }, scopeReady: false, loaded: false });
  });
});

describe('forced sign-out', () => {
  it('transitionToLocal moves a scope left on the account back to local', async () => {
    const server = fakeServer();
    client = makeClient(server);
    setActiveScope(USER_ID);
    const { win } = fakeWindow();
    await initAuthState(win);
    await flush();
    expect(getCurrentAuthState().kind).toBe('signed_in');
    expect(switchScopeMock).not.toHaveBeenCalled(); // scope already right
    transitionToLocal();
    await _scopeSwitchSettledForTests();
    expect(switchScopeMock).toHaveBeenCalledWith(null, { restored: false });
    expect(getActiveScope()).toBe('local');
    expect((await getAuthSnapshot()).scopeReady).toBe(true);
  });

  it('a SIGNED_OUT moves the scope and counts as a sign-out', async () => {
    const server = fakeServer();
    client = makeClient(server);
    setActiveScope(USER_ID);
    const { win } = fakeWindow();
    await initAuthState(win);
    await flush();
    await client.auth.signOut({ scope: 'local' });
    await flush();
    await _scopeSwitchSettledForTests();
    await flush();
    expect(switchScopeMock).toHaveBeenCalledWith(null, { restored: false });
    expect(getActiveScope()).toBe('local');
    expect(capture).toHaveBeenCalledWith('signed_out');
  });
});
