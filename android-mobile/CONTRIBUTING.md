# Contributing to Solphivia × SEI Android

Start with a small issue describing the problem and how to reproduce it, or an idea for a focused contribution. The Android preview lives under `android-mobile/`; shared SEI desktop files remain upstream code.

Contributions are welcome in native Android UI and lifecycle, game integration boundaries, companion behavior, speech/audio, privacy/session handling, accessibility, localization and device testing. Coordinate bigger architecture changes before implementing them.

For changes to the app, build the APK, run Android Lint and run the relevant device regressions. Report which checks were synthetic and which involved a real account or microphone. Do not commit signing keys, tokens, `local.properties`, private chat exports or identifiable user screenshots. Use synthetic test data for public demonstrations.

Keep the AGPL source obligations and existing notices. Solphivia character art has separate reserved rights: new art uses and derivatives require the project creators' agreement. Code contributions should not silently broaden that art license or imply official SEI endorsement.

Please include the Android version/device for bugs, short reproduction steps, expected behavior, observed behavior and sanitized logs. No passwords, tokens or full personal conversations are needed.
