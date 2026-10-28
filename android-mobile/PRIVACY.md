# Privacy notes for the Android preview

This preview stores companion settings and written chat locally in Android app-private storage. OAuth tokens are encrypted with Android Keystore-backed AES-GCM. The app does not collect analytics or store microphone audio files.

When you send a message or finish a spoken turn, your text, recent conversation and companion instructions go to OpenAI using the ChatGPT account you explicitly connect. Plan usage and any limits follow that account's authorization. The app cannot read your other ChatGPT conversations.

Voice transcription is performed by your Android speech service, which may use Google or another service and may send audio to that provider. Google TTS may use network processing. Read the selected providers' privacy policies. Leaving the voice screen stops recognition; use the visible Start, Mute and End controls.

JSON export contains your companion name/personality and conversation, but no account tokens. Conversation deletion removes that local chat. Disconnect removes local authorization credentials. You can revoke the app's access in ChatGPT settings. Backup/device transfer exclusions are configured.

These are implementation notes for an experimental build, not a final store privacy policy. Retention on provider infrastructure follows the relevant provider/account terms. A complete policy with publisher contact, rights requests and current service disclosures must be reviewed before broader distribution or a Play Store listing.
