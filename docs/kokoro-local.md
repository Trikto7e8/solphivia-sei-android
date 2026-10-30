# Optional Kokoro local voices

First implementation for [SEI issue #47](https://github.com/sei-studio/sei/issues/47).
No Python service, Docker service, new npm dependency, or bundled model is required.
Uses the existing `sherpa-onnx-node` 1.13.5 runtime and speech pack download/store.

## Setup

1. Use the **My key** backend and open Settings → Voice.
2. Select **Local**, then download **Kokoro-82M English and Italian voices**.
3. Select `Kokoro · af_heart · English` or `Kokoro · if_sara · Italiano`.
4. Use the voice preview or start a call. Select Automatic local voices to return
   to the existing language/gender mapping.

`local_tts_voice` accepts `auto` (also the absent default), `af_heart`, or `if_sara`.
It is stored in the local profile configuration. No character voice ID is changed.
The override applies to all companions and fixes pronunciation to the selected
voice's language. It does not add Italian STT, change language auto-detection,
translate generated text, or guarantee that the LLM answers in Italian.
Ask the companion to answer in Italian when testing Sara.
Cloud/ElevenLabs normal routing is unchanged. Models are never auto-downloaded
in a call. An explicitly selected missing Kokoro pack produces
`VOICE_PACK_MISSING:tts-kokoro`; it does not silently change the chosen voice.

## Model and architecture

- Pack: `kokoro-int8-multi-lang-v1_0.tar.bz2`, 132,353,410 bytes (~126 MiB).
- Origin: https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models
- Observed release SHA-256: `72c347230107ef8a31098ec4d468a605244beef5f1ed00db97efa13518800653`.
  The existing downloader verifies archive size and bzip2 CRC; this digest was
  checked manually during validation, and is not an additional runtime check.
- Existing mirror-first downloader, progress IPC, confirmation and removal UI.
  No claim that the SEI mirror already hosts this asset; origin fallback remains.
- Device-global models: `<userData>/speech-models/tts-kokoro/`.
- `kokoro.ts` holds only preset IDs and model config. Speaker IDs are **3** for
  Heart and **35** for Sara, from the [sherpa v1.0 voice table](https://github.com/k2-fsa/sherpa-onnx/blob/master/scripts/kokoro/v1.0/generate_voices_bin.py).
- Each preset has a lazy cached async engine with its own phonemizer language
  (`en-us` / `it`). Failed loads can retry. Each call checks pack readiness,
  including after removal. `enableExternalBuffer: false` preserves Electron's
  existing memory-cage requirement. Output uses SEI's existing WAV pipeline.
- Heart speed 0.8 reproduces the earlier user-reported experiment; Sara uses 1.0.
  The int8 ONNX/espeak route differs from the original Python Kokoro pipeline.

## Licenses and attribution

SEI's existing AGPL license is unchanged. No weights are committed or bundled.
[Kokoro-82M by hexgrad](https://huggingface.co/hexgrad/Kokoro-82M) weights are
Apache-2.0; the downloaded release's LICENSE is required and retained intact.
Conversion and quantization are by the sherpa-onnx project (Apache-2.0 runtime).
The pack also contains [espeak-ng](https://github.com/espeak-ng/espeak-ng)
phonemizer data (GPL-3.0-or-later); that data is not covered by the weights'
Apache license. Distributors mirroring/repackaging the archive must preserve
notices and meet the corresponding source obligations for those components.
The existing pack extraction retains all regular files, including notices.
Settings → About names the model, conversion and phonemizer separately.

## Reproduce checks

```sh
npm ci --ignore-scripts
npm test -- src/main/speech src/main/voice/tts.test.ts src/main/configStore.test.ts src/renderer/src/screens/SettingsScreen.test.tsx --maxWorkers=2
npm run typecheck
npm run build
```

The opt-in real test follows the existing speech-engine live test convention:
stage the extracted archive under
`<test-userData>/speech-models/tts-kokoro/kokoro-int8-multi-lang-v1_0/`
and a `pack.json` marker in its parent. Never point tests at production userData.
In PowerShell:

```powershell
$env:SEI_KOKORO_LIVE_DIR = 'C:\path\to\test-userData'
npm test -- src/main/speech/kokoro.live.test.ts --maxWorkers=1
```

It requires the platform runtime and real downloaded model, checks both voices'
nonempty, finite, non-silent 24 kHz PCM, and prints duration/timing. It runs under
Node, not Electron. Unit tests mock inference and cannot establish voice quality.

See `kokoro-validation.md` for actual results and untested surfaces.
