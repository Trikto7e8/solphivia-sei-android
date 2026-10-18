/**
 * Own-voice marker (261019): how a pick from the user's own ElevenLabs
 * account is persisted beside metadata.voiceId, and how any other pick
 * clears it.
 */
import { describe, it, expect } from 'vitest';
import { NO_VOICE_ID, OWN_VOICE_KEY, applyVoicePick, isWellFormedVoiceId, ownVoiceOf } from './voiceIds';

const OWN_ID = 'aBcDeFgHiJkLmNoPqRsT';

describe('isWellFormedVoiceId', () => {
  it('accepts ElevenLabs-style ids and rejects junk and sentinels', () => {
    expect(isWellFormedVoiceId(OWN_ID)).toBe(true);
    expect(isWellFormedVoiceId(NO_VOICE_ID)).toBe(false);
    expect(isWellFormedVoiceId('short')).toBe(false);
    expect(isWellFormedVoiceId('../../etc')).toBe(false);
    expect(isWellFormedVoiceId('has space here')).toBe(false);
    expect(isWellFormedVoiceId(42)).toBe(false);
    expect(isWellFormedVoiceId(undefined)).toBe(false);
  });
});

describe('ownVoiceOf', () => {
  it('reads the marker only beside a well-formed voiceId', () => {
    expect(ownVoiceOf({ voiceId: OWN_ID, voiceOwn: { name: 'My Clone', gender: 'male' } })).toEqual({
      name: 'My Clone',
      gender: 'male',
    });
    expect(ownVoiceOf({ voiceId: OWN_ID, voiceOwn: { name: 'No gender' } })).toEqual({ name: 'No gender' });
    expect(ownVoiceOf({ voiceId: NO_VOICE_ID, voiceOwn: { name: 'x' } })).toBeNull();
    expect(ownVoiceOf({ voiceOwn: { name: 'x' } })).toBeNull();
    expect(ownVoiceOf({ voiceId: OWN_ID })).toBeNull();
    expect(ownVoiceOf({ voiceId: OWN_ID, voiceOwn: { name: '  ' } })).toBeNull();
    expect(ownVoiceOf({ voiceId: OWN_ID, voiceOwn: 'My Clone' })).toBeNull();
    expect(ownVoiceOf(null)).toBeNull();
    expect(ownVoiceOf(undefined)).toBeNull();
  });

  it('clamps synced junk', () => {
    const own = ownVoiceOf({ voiceId: OWN_ID, voiceOwn: { name: 'n'.repeat(500), gender: 'g'.repeat(50) } });
    expect(own?.name.length).toBe(100);
    expect(own?.gender?.length).toBe(20);
  });
});

describe('applyVoicePick', () => {
  it('an own pick stores voiceId + the marker and keeps other metadata', () => {
    const next = applyVoicePick({ voicePitch: 1.1, other: 'kept' }, OWN_ID, { name: 'My Clone', gender: 'male' });
    expect(next).toEqual({
      voicePitch: 1.1,
      other: 'kept',
      voiceId: OWN_ID,
      [OWN_VOICE_KEY]: { name: 'My Clone', gender: 'male' },
    });
    expect(ownVoiceOf(next)).toEqual({ name: 'My Clone', gender: 'male' });
  });

  it('a pool pick, Auto, or No voice clears the marker', () => {
    const start = { voiceId: OWN_ID, voiceOwn: { name: 'My Clone' } };
    expect(applyVoicePick(start, 'PoolVoice1234567890a')).toEqual({ voiceId: 'PoolVoice1234567890a' });
    expect(applyVoicePick(start, null)).toEqual({});
    expect(applyVoicePick(start, NO_VOICE_ID)).toEqual({ voiceId: NO_VOICE_ID });
    // an own marker cannot ride along with a sentinel or a null id.
    expect(applyVoicePick(start, NO_VOICE_ID, { name: 'x' })).toEqual({ voiceId: NO_VOICE_ID });
    expect(applyVoicePick(start, null, { name: 'x' })).toEqual({});
  });

  it('does not mutate the input', () => {
    const start = { voiceId: OWN_ID, voiceOwn: { name: 'My Clone' } };
    applyVoicePick(start, null);
    expect(start).toEqual({ voiceId: OWN_ID, voiceOwn: { name: 'My Clone' } });
    expect(applyVoicePick(undefined, OWN_ID, { name: 'A' })).toEqual({ voiceId: OWN_ID, voiceOwn: { name: 'A' } });
  });
});
