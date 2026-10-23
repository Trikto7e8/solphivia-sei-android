import { describe, it, expect } from 'vitest';
import { localImportOfferTiming, shouldOfferLocalImport } from './localImportOffer';
import type { PeekLocalProfileResult } from '../../../shared/ipc';

function peek(p: Partial<PeekLocalProfileResult>): PeekLocalProfileResult {
  return {
    migratableCharacterIds: [],
    memoryOnlyCharacterIds: [],
    mcUsername: null,
    preferredName: null,
    hasData: false,
    hasCompanionData: false,
    ...p,
  };
}

describe('shouldOfferLocalImport', () => {
  it('offers local companions to an EXISTING account (bug 1)', () => {
    const p = peek({ migratableCharacterIds: ['a'], hasData: true, hasCompanionData: true });
    expect(shouldOfferLocalImport(p, true)).toBe(true);
  });

  it('offers memories alone to an existing account', () => {
    const p = peek({ memoryOnlyCharacterIds: ['a'], hasData: true, hasCompanionData: true });
    expect(shouldOfferLocalImport(p, true)).toBe(true);
  });

  it('does not prompt an existing account over onboarding answers alone', () => {
    const p = peek({ mcUsername: 'Steve', hasData: true });
    expect(shouldOfferLocalImport(p, true)).toBe(false);
    // A new account still takes them.
    expect(shouldOfferLocalImport(p, false)).toBe(true);
  });

  it('offers nothing when the local profile is empty or the peek failed', () => {
    expect(shouldOfferLocalImport(peek({}), false)).toBe(false);
    expect(shouldOfferLocalImport(null, true)).toBe(false);
  });
});

describe('localImportOfferTiming', () => {
  it('offers on sign-in, deferred while the first-run scene is up', () => {
    expect(localImportOfferTiming('sign-in', false)).toBe('now');
    expect(localImportOfferTiming('sign-in', true)).toBe('after-onboarding');
  });

  it('never offers on sign-out or account to account', () => {
    expect(localImportOfferTiming('sign-out', false)).toBe('none');
    expect(localImportOfferTiming('switch', false)).toBe('none');
    expect(localImportOfferTiming('switch', true)).toBe('none');
  });
});
