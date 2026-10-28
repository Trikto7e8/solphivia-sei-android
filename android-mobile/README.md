# Solphivia × SEI — Android preview

Community Android work based on [SEI](https://github.com/sei-studio/sei) and [Solphivia Mobile](https://github.com/Trikto7e8/solphivia-avatar-ai). This is an independent experiment, not an official SEI release. The upstream Electron app is preserved; Android code lives in this folder.

## What works in this preview

- A native Android chat surface and editable companion name/personality.
- Sign in with ChatGPT in the phone's browser, adapted from Solphivia Mobile. No separate API key is requested. Plan authorization is completed by the user.
- Streaming responses, Stop, retry drafts, local conversation history, JSON export and deletion.
- Solphivia's animated avatar and sprite controller, reused with the project creator's authorization.
- Offline tic-tac-toe against a minimax opponent. Moves are local game logic; the model does not choose them. A button brings game context into a chat draft.
- Foreground, turn-based voice: Android speech recognition → ChatGPT text response → Google Italian TTS → listen again. Start, mute and end controls are explicit. Leaving the screen stops the microphone.

This does **not** yet port SEI accounts/cloud characters, long-term memory, game adapters, screen sharing, Live2D, group calls or full-duplex realtime audio. This is a small native Android surface, not the desktop React UI running on a phone.

## Build in Android Studio

Open **`android-mobile/`**, not the Electron repository root. Install Android SDK Platform 35 and Build Tools 35.0.0. Use JDK 17 or 21 with the included Gradle 8.11.1 wrapper and Android Gradle Plugin 8.9.1. JDK 25 is not compatible with this Gradle version.

From this folder:

```sh
./gradlew assembleDebug lintDebug assembleDebugAndroidTest bundleRelease
```

On Windows use `gradlew.bat`. Android Studio writes `local.properties` with your SDK path. Keep it local. No Gradle dependencies beyond AGP are needed by the app.

Outputs:

- Debug APK: `app/build/outputs/apk/debug/app-debug.apk`
- Test APK: `app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk`
- Unsigned release bundle: `app/build/outputs/bundle/release/app-release.aab`

The released test APK is debug-signed. The AAB generation is verified, but no upload key or Play signing configuration is included. Do not treat it as a production release.

The adapted baseline is checked in as an Android asset. After changing the upstream prompt, regenerate it from the repository root:

```sh
node android-mobile/extract-prompt.mjs
```

## Device regression runner

The runner preserves existing chat preferences, uses a synthetic credential probe, and never signs in or opens the microphone. Run it while not using the app interactively:

```sh
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell am force-stop org.seimobile
adb shell am instrument -w org.seimobile.test/org.seimobile.SmokeInstrumentation
```

Ten checks passed on a Motorola moto g35 5G running Android 16 on 2026-10-28. The test suite covers draft restart, companion settings, empty messages, malformed ID tokens, exhaustive game paths, credential encryption, game UI, microphone default-off, Italian TTS initialization and nonempty synthesized audio. See [the device result](../docs/android/device-tests.txt).

Written ChatGPT replies were also observed on the connected phone after the user signed in. A complete spoken microphone-to-model-to-speaker exchange and background/interruption behavior still need live acceptance tests. A generated audio file confirms synthesis, not the perceived naturalness of the voice.

## Privacy and account boundary

Chat and personality are stored in app-private preferences. Only the last 30 messages plus the new message are sent with the companion instructions when the user sends. OAuth tokens are encrypted with AES-GCM and an Android Keystore key. Tokens are never exported or checked into Git.

Authorization uses the system browser, state, PKCE and nonce, followed by signed ID-token validation. The callback listener runs on loopback while a foreground service keeps it alive. Responses use the public Responses API with `store:false` and `stream:true`. The app waits for completion before saving a reply. ChatGPT conversation history is separate from this app's history.

Android/Google speech recognition may process audio remotely depending on the selected device service, even though the app prefers offline recognition. Sei Mobile does not save microphone recordings. System TTS may use a network voice. No analytics SDK is added. Automatic cloud backup and device transfer of app data are excluded; export is an explicit JSON action.

The local Disconnect button removes this app's stored credentials. The user can also revoke authorization from ChatGPT settings. Account switching, token revocation UX and storage recovery need further review before a store release.

## Sources and licenses

- SEI source baseline: `406959b70ba2bb932eeedcb336be31d689441f52`, under [AGPL-3.0](../LICENSE).
- Solphivia Mobile: `Trikto7e8/solphivia-avatar-ai`, local source commit `0b597ae`, version `1.1.0-beta.3`. OAuth helpers, the foreground callback service and `PetView` were adapted. Its source attribution and MIT terms are retained in [LICENSE-SOLPHIVIA](LICENSE-SOLPHIVIA).
- Solphivia artwork remains separately reserved to its creators; see [ASSETS-SOLPHIVIA.md](ASSETS-SOLPHIVIA.md). The creator authorized this integration. This does not grant third parties an unrestricted license to the character art.
- The launcher symbol is a new geometric icon. Original SEI screenshots in the repository are desktop references, not Android feature claims.

## Before any Play Store submission

Agree the product name/branding and asset distribution with the relevant maintainers; choose a permanent application ID; add release signing and a repeatable release workflow; complete privacy policy and Data Safety declarations; review permissions, localization and accessibility; test microphone denial, interruption, refresh/revocation, process death, offline behavior and a range of Android versions. Confirm current target API/store requirements at submission time.

No Play Store submission has been made. Contributors can help with those tasks without changing the original desktop application.
