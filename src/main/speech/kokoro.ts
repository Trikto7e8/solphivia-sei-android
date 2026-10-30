import path from 'node:path';

/** Speaker order is specific to sherpa's v1.0 voices.bin, not the HF listing:
 * https://github.com/k2-fsa/sherpa-onnx/blob/master/scripts/kokoro/v1.0/generate_voices_bin.py
 * Heart keeps the 0.8 speed used in issue #47's earlier experiment. */
export const KOKORO_VOICES = {
  af_heart: { sid: 3, lang: 'en-us', rate: 0.8 },
  if_sara: { sid: 35, lang: 'it', rate: 1.0 },
} as const;
export type KokoroVoice = keyof typeof KOKORO_VOICES;

export function kokoroConfig(dir: string, voice: KokoroVoice) {
  return {
    model: {
      kokoro: {
        model: path.join(dir, 'model.int8.onnx'),
        voices: path.join(dir, 'voices.bin'),
        tokens: path.join(dir, 'tokens.txt'),
        dataDir: path.join(dir, 'espeak-ng-data'),
        lang: KOKORO_VOICES[voice].lang,
      },
      numThreads: 2,
      debug: false,
      provider: 'cpu',
    },
    maxNumSentences: 1,
  };
}
