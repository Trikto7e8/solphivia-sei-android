# Kokoro validation — 2026-10-30

Base: `sei-studio/sei` main and `Trikto7e8/solphivia-sei-android` main both at
`406959b70ba2bb932eeedcb336be31d689441f52` (v0.6.10). Work is on a separate
`feat/kokoro-local` branch, without Android-branch changes.

Host: Windows x64, Intel Core i7-6700 3.40 GHz, 8 logical CPUs, ~11.88 GiB RAM,
Node 24.22.1, sherpa-onnx-node 1.13.5. Dependencies installed with lifecycle
scripts disabled. No dependency versions or lockfile changed.

## Actual checks

- TypeScript build/typecheck: passed.
- Production electron-vite build (main, preload, renderer): passed.
- Focused speech, TTS, config and Settings tests: 172 passed, 3 opt-in live tests
  skipped in the ordinary run (12 files, 10 passed / 2 skipped).
- Added call/preview routing and silent-character tests, plus reruns of three
  failures seen under high concurrency: 221 passed, 3 skipped (16 files,
  14 passed / 2 skipped). Those reruns all passed with `--maxWorkers=2`.
- Real `kokoro.live.test.ts`: **1 passed**; both voices passed through real
  pack readiness checks and SEI's native runtime host using isolated staged
  userData. PCM was finite, non-silent and 24 kHz.
- Actual downloaded archive matched both the release byte count and published
  SHA-256. The project's own bzip2 decoder and tar parser read the real archive;
  native tar then staged the decoded archive for real runtime tests.
- `git diff --check`: passed.

Full suite first run: 477 files passed / 32 failed / 3 skipped;
5,768 tests passed / 39 failed / 17 skipped. This was not a green suite.
An independent baseline run temporarily restored original tracked source files,
excluded the new Kokoro tests, and restored all changes afterwards:
479 files passed / 29 failed / 3 skipped; 5,768 tests passed / 36 failed /
17 skipped. The 50 baseline failure records (suite import failures included)
were all also in the changed run. The changed run had three additional failure
records: chessService coalescing, memoryLog seed budget, and McSteps initial
scan. All three passed on the modified source when rerun with two workers.
Baseline problems include missing optional game dependencies, Windows path/mode
assumptions, stale version expectations, and quality-eval imports. This change
does not claim to fix the repository-wide suite.

## One-shot real synthesis measurements

Standalone Node probe using the same `kokoroConfig`, two CPU threads, fresh
engine per preset. Single observation per voice, without warmup or repetitions;
not a statistically reliable benchmark and not end-to-end call latency.

| Preset | Speed | Load | Synthesis | Audio duration | RTF |
| --- | ---: | ---: | ---: | ---: | ---: |
| af_heart (speaker 3) | 0.8 | 2.631 s | 10.684 s | 4.818 s | 2.217 |
| if_sara (speaker 35) | 1.0 | 1.650 s | 7.227 s | 3.764 s | 1.920 |

English input: “Hello Marco, this is a test of the local English voice in SEI.”
Italian input: “Ciao Marco, questa è una prova della voce italiana locale in SEI.”
Both generated WAV files at 24 kHz. This machine was slower than real time in
these observations. No claim of acceptable conversational latency is made.

## Not performed / remaining review

- No human listening assessment of pronunciation, expressiveness or artifacts.
- No packaged Electron launch/call, installer, Settings interaction, or
  end-to-end download through the running app. Build success is not that test.
- No macOS/Linux/ARM execution or Electron native-addon compatibility matrix.
- No Italian recognition or general chat-language expansion: explicit Sara
  selection changes only TTS pronunciation and voice. Prompt Italian responses.
- No repeated cold/warm latency, interruption, long-text or memory benchmark.
- The earlier `af_heart` / `if_sara` experiments are user reports in issue #47;
  no original scripts or raw measurements were retrieved. New measurements
  above are independent, using int8 ONNX with espeak rather than Python Misaki.
- No confirmation that the maintainer's mirror already contains the new pack.

This is an initial draft contribution for review, not a production-readiness
claim. Keep the existing automatic voices as the default.
