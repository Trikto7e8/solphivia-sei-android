/**
 * Tests for the Supabase client singleton + storage-adapter wiring.
 *
 * Stubs env.ts so the test does not require real Supabase credentials.
 * Stubs @supabase/supabase-js's createClient so the test doesn't depend on
 * actually being able to reach a Supabase project — we only assert the
 * call arguments + singleton behavior + ordering invariants.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../env', () => ({
  getSupabaseUrl: () => 'https://stub.supabase.co',
  getSupabaseAnonKey: () => 'stub-anon-key',
}));

const createClientMock = vi.fn((..._args: unknown[]) => ({ __stub: true } as unknown));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

// Imported AFTER mocks so the module uses the stubs.
import {
  getClient,
  setStorageAdapter,
  persistedSessionUserId,
  userIdFromPersistedSession,
  _resetForTests,
  type StorageAdapter,
} from './supabaseClient';

const stubAdapter: StorageAdapter = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
};

beforeEach(() => {
  createClientMock.mockClear();
  _resetForTests();
});

afterEach(() => {
  _resetForTests();
});

describe('supabaseClient', () => {
  it('getClient() before setStorageAdapter() throws SUPABASE_NO_STORAGE_ADAPTER', () => {
    expect(() => getClient()).toThrowError(/SUPABASE_NO_STORAGE_ADAPTER/);
  });

  it('after setStorageAdapter(stubAdapter), two getClient() calls return the same instance', () => {
    setStorageAdapter(stubAdapter);
    const first = getClient();
    const second = getClient();
    expect(first).toBe(second);
    // createClient called exactly once — singleton
    expect(createClientMock).toHaveBeenCalledTimes(1);
  });

  it('setStorageAdapter() after getClient() throws SUPABASE_CLIENT_ALREADY_CREATED', () => {
    setStorageAdapter(stubAdapter);
    getClient();
    expect(() => setStorageAdapter(stubAdapter)).toThrowError(/SUPABASE_CLIENT_ALREADY_CREATED/);
  });
});

describe('persisted session user id (261029 boot scope)', () => {
  const ID = '6F1C2A3B-4D5E-4F60-8A7B-9C0D1E2F3A4B';
  it('reads the user id out of a stored session, lowercased', () => {
    expect(userIdFromPersistedSession(JSON.stringify({ access_token: 'x', user: { id: ID } }))).toBe(ID.toLowerCase());
    expect(userIdFromPersistedSession(JSON.stringify({ currentSession: { user: { id: ID } } }))).toBe(ID.toLowerCase());
  });
  it('is null for nothing stored, junk, or an id that is not a UUID', () => {
    expect(userIdFromPersistedSession(null)).toBeNull();
    expect(userIdFromPersistedSession('not json')).toBeNull();
    expect(userIdFromPersistedSession(JSON.stringify({ user: { id: '../etc' } }))).toBeNull();
    expect(userIdFromPersistedSession(JSON.stringify({ user: null }))).toBeNull();
  });
  it("reads the client's own storage key through the adapter", async () => {
    const getItem = vi.fn(async (k: string) => (k === 'sb-stub-auth-token' ? JSON.stringify({ user: { id: ID } }) : null));
    const storage: StorageAdapter = { ...stubAdapter, getItem };
    const client = { auth: { storageKey: 'sb-stub-auth-token' } } as never;
    expect(await persistedSessionUserId({ client, storage })).toBe(ID.toLowerCase());
    expect(await persistedSessionUserId({ client, storage: null })).toBeNull();
  });
});
