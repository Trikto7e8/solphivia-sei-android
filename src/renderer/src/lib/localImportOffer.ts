/**
 * When to offer bringing the own-key (local) profile's companions into a Sei
 * account (261023).
 *
 * The offer used to come only on a sign-in to a NEW account (no name yet) made
 * outside the first-run scene. Signing into an EXISTING account, or signing in
 * from the scene's sign-in panel (where a signed-out own-key player lands at
 * every launch), skipped it, so the local companions and memories stayed
 * behind in the local profile with nothing pointing at them.
 */
import type { PeekLocalProfileResult, ScopeChangedEvent } from '../../../shared/ipc';

/**
 * Whether the peek has anything to offer. A new account also takes the
 * onboarding answers (name); an existing one already has its own, so only
 * companions or memories are worth a prompt.
 */
export function shouldOfferLocalImport(
  peek: PeekLocalProfileResult | null | undefined,
  existingAccount: boolean,
): boolean {
  if (!peek) return false;
  return existingAccount ? peek.hasCompanionData === true : peek.hasData === true;
}

/**
 * On a scope change: offer now, after the first-run scene hands off (it owns
 * navigation while it is up), or not at all (sign-out, account to account).
 */
export function localImportOfferTiming(
  reason: ScopeChangedEvent['reason'],
  inOnboarding: boolean,
): 'now' | 'after-onboarding' | 'none' {
  if (reason !== 'sign-in') return 'none';
  return inOnboarding ? 'after-onboarding' : 'now';
}
