import { describe, it, expect, vi, beforeEach } from 'vitest';
const m = vi.hoisted(() => ({
  config: { tts_engine: 'local', local_tts_voice: 'if_sara', chat_language: 'en' },
  synthesize: vi.fn(),
  character: { id: 'c1', name: 'Test', metadata: { voiceId: 'voice123456789' } },
}));
vi.mock('../configStore', () => ({ loadConfig: async () => m.config }));
vi.mock('../apiKeyStore', () => ({ getAiBackendKind: async () => 'local' }));
vi.mock('../characterStore', () => ({ getCharacter: async () => m.character }));
vi.mock('./voiceAssign', () => ({ resolveVoiceId: async () => 'voice123456789', ownVoicePickOf: () => null, isPoolVoiceId: () => true, ownVoiceStandInId: () => 'voice123456789' }));
vi.mock('../speech', () => ({ synthesizeKokoro: m.synthesize }));
vi.mock('../auth/supabaseClient', () => ({ getClient: () => null }));
vi.mock('./elevenLabsKeyStore', () => ({ resolveElevenLabsRoute: vi.fn(), resolveTtsRoute: vi.fn() }));
vi.mock('./ownVoices', () => ({ isOwnVoiceId: () => false }));
vi.mock('../creditWall', () => ({ noteCreditWall: vi.fn() }));
vi.mock('./stt', () => ({ encodeWav: () => new TextEncoder().encode('RIFF').buffer }));
import { voiceTts, voicePreviewTts } from './tts';

describe('Kokoro TTS routing', () => {
  beforeEach(() => {
    m.config.local_tts_voice = 'if_sara';
    m.character.metadata.voiceId = 'voice123456789';
    m.synthesize.mockReset().mockResolvedValue({ samples: new Float32Array([0.1]), sampleRate: 24000 });
  });
  it('routes a call and preview to the selected local voice without changing character identity', async () => {
    await voiceTts({ characterId: 'c1', text: 'Ciao Marco.' });
    expect(m.synthesize).toHaveBeenCalledWith(expect.any(String), 'if_sara');
    expect(m.character.metadata.voiceId).toBe('voice123456789');
    await voicePreviewTts({ characterId: 'c1' });
    expect(m.synthesize).toHaveBeenLastCalledWith(expect.stringContaining('voce italiana'), 'if_sara');
    m.config.local_tts_voice = 'af_heart';
    await voicePreviewTts({ characterId: 'c1' });
    expect(m.synthesize).toHaveBeenLastCalledWith(expect.any(String), 'af_heart');
  });
  it('surfaces a missing selected pack and never synthesizes a silent character', async () => {
    m.synthesize.mockRejectedValue(new Error('VOICE_PACK_MISSING:tts-kokoro'));
    await expect(voiceTts({ characterId: 'c1', text: 'Ciao.' })).rejects.toThrow('VOICE_PACK_MISSING:tts-kokoro');
    m.synthesize.mockClear();
    m.character.metadata.voiceId = 'none';
    await expect(voiceTts({ characterId: 'c1', text: 'Ciao.' })).rejects.toThrow('VOICE_DISABLED');
    expect(m.synthesize).not.toHaveBeenCalled();
  });
});
