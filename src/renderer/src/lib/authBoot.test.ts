/**
 * 261029 (login lock on restart): the renderer's on-demand read of main's auth
 * state. The boot routing and the onboarding sign-in panel use it instead of
 * waiting on pushes that may have landed before they listened.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSnapshot } from '@shared/ipc';

const bridge = vi.hoisted((): { authSnapshot?: () => Promise<unknown> } => ({}));
vi.mock('./ipcClient', () => ({ sei: bridge }));

import { readAuthSnapshot, waitForAuthScope } from './authBoot';

const signedIn = (scopeReady: boolean): AuthSnapshot => ({
  state: {
    kind: 'signed_in',
    user: { id: 'u1', email: 'a@b.c', emailVerified: true, createdAt: '2026-01-01T00:00:00Z' },
  },
  scopeReady,
  loaded: true,
});
const noSleep = (): Promise<void> => Promise.resolve();

beforeEach(() => {
  delete bridge.authSnapshot;
});

describe('readAuthSnapshot', () => {
  it('is null when the bridge has no snapshot (older preload, test stubs)', async () => {
    expect(await readAuthSnapshot()).toBeNull();
  });
  it('is null when the call rejects or answers junk', async () => {
    bridge.authSnapshot = () => Promise.reject(new Error('no handler'));
    expect(await readAuthSnapshot()).toBeNull();
    bridge.authSnapshot = () => Promise.resolve({ nope: true });
    expect(await readAuthSnapshot()).toBeNull();
  });
  it("returns main's answer", async () => {
    bridge.authSnapshot = () => Promise.resolve(signedIn(true));
    expect(await readAuthSnapshot()).toEqual(signedIn(true));
  });
});

describe('waitForAuthScope', () => {
  it('does not wait when the scope is already ready', async () => {
    const fn = vi.fn(() => Promise.resolve(signedIn(true)));
    bridge.authSnapshot = fn;
    expect(await waitForAuthScope({ sleep: noSleep })).toEqual({ snapshot: signedIn(true), waited: false });
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('polls through a scope switch and says it waited', async () => {
    const answers = [signedIn(false), signedIn(false), signedIn(true)];
    bridge.authSnapshot = () => Promise.resolve(answers.shift() ?? signedIn(true));
    expect(await waitForAuthScope({ sleep: noSleep })).toEqual({ snapshot: signedIn(true), waited: true });
  });
  it('gives up after the bound with the last answer', async () => {
    bridge.authSnapshot = () => Promise.resolve(signedIn(false));
    const sleep = vi.fn(noSleep);
    const res = await waitForAuthScope({ sleep, timeoutMs: 900 });
    expect(res).toEqual({ snapshot: signedIn(false), waited: true });
    expect(sleep).toHaveBeenCalledTimes(3);
  });
  it("does not poll when main answered before its own session load finished", async () => {
    const early: AuthSnapshot = { state: { kind: 'local' }, scopeReady: false, loaded: false };
    bridge.authSnapshot = () => Promise.resolve(early);
    const sleep = vi.fn(noSleep);
    expect(await waitForAuthScope({ sleep })).toEqual({ snapshot: early, waited: false });
    expect(sleep).not.toHaveBeenCalled();
  });
  it('stops when cancelled, and passes through a missing bridge', async () => {
    bridge.authSnapshot = () => Promise.resolve(signedIn(false));
    const sleep = vi.fn(noSleep);
    await waitForAuthScope({ sleep, isCancelled: () => true });
    expect(sleep).not.toHaveBeenCalled();
    delete bridge.authSnapshot;
    expect(await waitForAuthScope({ sleep })).toEqual({ snapshot: null, waited: false });
  });
});
