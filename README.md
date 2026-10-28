<div align="center">

# Solphivia × SEI · Android

### Una companion che parla e gioca con te. O contro di te.
### A companion to talk, play together, or challenge each other.

[![Android preview](https://img.shields.io/badge/Android-community_preview-9cc5ff?style=for-the-badge&logo=android)](https://github.com/Trikto7e8/solphivia-sei-android/releases/tag/android-v0.3.0-preview)
[![Collaborate](https://img.shields.io/badge/Contributors-welcome-a4e0bf?style=for-the-badge)](https://github.com/Trikto7e8/solphivia-sei-android/issues)

**[Try the Android APK](https://github.com/Trikto7e8/solphivia-sei-android/releases/download/android-v0.3.0-preview/solphivia-sei-android-0.3.0-debug.apk) · [Build from source](android-mobile/README.md) · [Solphivia Mobile](https://github.com/Trikto7e8/solphivia-avatar-ai) · [Original SEI](https://github.com/sei-studio/sei)**

<img src="docs/android/solphivia-in-sei-desktop.png" width="960" alt="Solphivia's purple-haired character shown in SEI desktop, supplied by the creator as a visual reference" />

*Solphivia in SEI desktop: the visual reference behind this experiment. This image is not an Android screenshot.*

</div>

We want a companion on Android with a recognizable character, a voice and shared play. This independent community fork brings together [SEI's AI gaming companion idea](https://github.com/sei-studio/sei) and the avatar, browser sign-in and Android experience from [Solphivia Mobile](https://github.com/Trikto7e8/solphivia-avatar-ai). It is a starting point for collaboration, not an official SEI mobile release.

Vogliamo portare su Android una companion con cui parlare, giocare insieme e sfidarsi, mantenendo personalità e presenza. Il progetto unisce l'idea di SEI all'esperienza Android di Solphivia Mobile. È una preview aperta ai contributi, da costruire insieme.

## Solphivia is part of the experience

<img src="docs/android/solphivia-banner.png" width="900" alt="Solphivia Mobile's original character and visual identity" />

Her original sprites are already used in the Android app: idle, listening, speaking, thinking and game reactions. They are the same character assets from Solphivia Mobile, not replacement illustrations. The gallery below shows three original sprite looks; the preview currently uses the professor look in its conversation and game surfaces.

<table>
<tr><td align="center"><img src="docs/android/sprite-prof.png" width="210" alt="Original Solphivia professor sprite" /></td><td align="center"><img src="docs/android/sprite-vj.png" width="210" alt="Original Solphivia VJ sprite" /></td><td align="center"><img src="docs/android/sprite-codex.png" width="210" alt="Original Solphivia Codex sprite" /></td></tr>
<tr><td align="center">Prof · presence & conversation</td><td align="center">VJ · Solphivia's visual identity</td><td align="center">Codex · making things together</td></tr>
</table>

## A real Android starting point

<table>
<tr><td align="center"><img src="docs/android/android-game.png" width="310" alt="Actual Android tic-tac-toe game on a Motorola phone, with Solphivia's animated sprite and a synthetic test companion" /></td></tr>
</table>

**Available in the 0.3.0 preview**

- Native Android UI with an animated Solphivia companion.
- Configurable personality, written chat and ChatGPT browser sign-in.
- Streaming replies, Stop, retry drafts, local history, export and deletion.
- A first offline game: tic-tac-toe against a local opponent.
- Foreground, turn-based voice with Android speech recognition and Google Italian TTS.

The board shown here is a real phone screenshot from a synthetic device test. The companion's game moves use local minimax logic; they are not LLM-controlled moves.

**Verified:** APK build, installation, launch, Android Lint with no errors, release AAB generation and [10 device regressions](docs/android/device-tests.txt). Written ChatGPT replies were observed on the phone after the user signed in.

**Still to validate:** a full spoken live exchange, microphone interruptions, broader device coverage and production account/release handling. The voice screen is turn-based, not a full-duplex realtime call.

The original SEI desktop app remains available in this fork. Android implementation and build instructions are in **[`android-mobile/`](android-mobile/README.md)**. Desktop screenshots and character visuals are references, not claims that all SEI desktop features have already been ported.

## Join us / Collaboriamo

We would love help from Android developers, game-integration contributors, voice/audio developers, artists and testers. Useful first contributions include accessibility and localization, Android lifecycle fixes, companion/game interfaces, speech and latency testing, and reviewing privacy, token/session handling and packaging.

Try the preview, share a reproducible bug, propose a small feature, or open an issue telling us what you would like to work on. Keep contributions focused and testable. We welcome guidance and collaboration from the SEI maintainers, especially on the right boundaries between this Android experiment and their shared companion code.

**[Open an issue / Proponi un contributo](https://github.com/Trikto7e8/solphivia-sei-android/issues/new)** · **[Solphivia Mobile project](https://github.com/Trikto7e8/solphivia-avatar-ai)**

## Preview, privacy and licensing

The downloadable APK is **debug-signed and experimental**, for testing rather than a public store launch. Android 7+ is the build minimum; device testing so far is on a Motorola moto g35 5G with Android 16. A future Play Store release is a direction to evaluate after validation and maintainer feedback, not a release commitment.

Read the [Android documentation](android-mobile/README.md) and [privacy notes](android-mobile/PRIVACY.md) before connecting an account. No credentials or private conversations are shipped. Source derives from SEI under [AGPL-3.0](LICENSE), with Solphivia source attribution in [LICENSE-SOLPHIVIA](android-mobile/LICENSE-SOLPHIVIA). Solphivia character art has [separate reserved rights](android-mobile/ASSETS-SOLPHIVIA.md), retained by its creators and authorized here by the project creator. The existing SEI names and visuals identify the source project; this fork is independent and does not imply endorsement.

---

<details>
<summary>Original SEI desktop README and credits</summary>

<div align="center">

[<img src="docs/sei-logo-blue.png" alt="Sei" width="240" />](https://sei.gg)

AI gaming companions. Call, livestream, and game with unique characters.

<img src="docs/app-home.png" alt="Sei home screen" width="720" />

<br />

[<img src="docs/btn-macos.svg" alt="Download for macOS (Apple Silicon)" height="46" />](https://github.com/sei-studio/sei/releases/latest/download/Sei-mac-arm64.dmg)
&nbsp;
[<img src="docs/btn-windows.svg" alt="Download for Windows" height="46" />](https://github.com/sei-studio/sei/releases/latest/download/Sei-win-x64.exe)

<sub>On an Intel Mac? [Download the Intel build](https://github.com/sei-studio/sei/releases/latest/download/Sei-mac-x64.dmg).</sub>

</div>

---

Sei ([sei.gg](https://sei.gg)) is an AI gaming companion app for macOS and Windows. You pick a companion, then chat, call, and play games together. In Minecraft (Java Edition), Stardew Valley, and Don't Starve Together the companion joins your game as a second player. In the app you can play chess and Draw! with it. With Backseat, it watches you play any other game, including Roblox, and talks with you about it. Sei can match you with companions, you can make your own, or you can import one you already talk to on another platform. Each companion has its own personality and a long-term memory that follows it from game to game.

<sub>Not an official Roblox product. Not affiliated with, sponsored, or endorsed by Roblox Corporation. Roblox is a trademark of Roblox Corporation.</sub>

<div align="center">

<table>
<tr>
<td><img src="docs/shot-voice.png" alt="A group voice call in Sei" width="240" /></td>
<td><img src="docs/shot-minecraft.png" alt="A Sei companion playing Minecraft" width="240" /></td>
<td><img src="docs/shot-chess.png" alt="A Sei companion playing chess" width="240" /></td>
</tr>
<tr>
<td align="center"><sub>Voice calls</sub></td>
<td align="center"><sub>Your games</sub></td>
<td align="center"><sub>In-app games</sub></td>
</tr>
</table>

</div>

## What it does

**Games**

- **Minecraft (Java Edition):** your companion joins your world opened to LAN as its own player, with its own skin. It follows, mines, gathers, crafts, builds, fights, and can see what is around it. More than one companion can join the same world.
- **Stardew Valley:** your companion comes to your farm. It farms, clears land, waters and harvests, ships produce, fishes, and hands you items.
- **Don't Starve Together:** your companion joins the world you host as a survivor it picks itself. It gathers, builds, keeps the fire going, fights, and warns you about danger.
- **Chess:** play untimed games against your companion on a 3D board. Its human-like moves come from the Maia-3 model at 400 to 2000 Elo, and its strength adapts to how you play. It talks while you play.
- **Draw!:** take turns sketching and guessing words with your companion. A web version with Sui is free at [sei.gg/draw](https://sei.gg/draw).
- **Roblox (Backseat):** your companion watches your screen while you play. Tell it which Roblox game you are in and it knows a bit about it, comments as you go, and looks things up when you ask. It does not play inside Roblox.

**Everywhere**

- **Voice calls:** solo or group calls in English, Chinese, Japanese, Korean, French, or Spanish, during a game or on their own.
- **Backseat (beta):** share a window or your whole screen on a call and your companion watches any game with you and talks about it. No mods or per-game setup.
- **Long-term memory:** companions remember you across chats, calls, and games.
- **Knowledge import:** add text files (memories from another platform, facts about you) that a companion always knows.
- **Avatar overlay:** an always-on-top window with your companion's portrait or an imported Live2D model.
- **Web search:** companions can look things up and read pages, and say so before they do.

## Download

Get Sei from [sei.gg](https://sei.gg) or [GitHub Releases](https://github.com/sei-studio/sei/releases/latest). Builds are signed for macOS (Apple Silicon and Intel) and Windows (x64). The app updates itself.

## Requirements

- **Computer:** macOS on Apple Silicon or Intel, or Windows x64.
- **Minecraft:** Java Edition, 1.8 to 26.3 (most releases in that range). Bedrock, console, and mobile are not supported. On first use, Sei adds a "Sei" profile to the Minecraft Launcher so your companion shows up with its skin.
- **Stardew Valley:** PC version 1.6.14 or newer, from Steam or GOG. Sei installs SMAPI and its helper mod for you.
- **Don't Starve Together:** the Steam version, on a world you host. Sei installs its helper mod. One companion per world for now. Friends who join need nothing installed.

## Plans, your own key, or local models

- **Cloud (sign in):** no API key and no setup. There is a free tier and paid plans. See [sei.gg](https://sei.gg) for current plans.
- **Your own API key:** run Sei on your own key with Anthropic, OpenAI, DeepSeek, Qwen, Google Gemini, Grok, or OpenRouter.
- **Local models:** run fully on your machine with [Ollama](https://ollama.com). No key needed. Local voice packs and on-device speech recognition are available too.

## Privacy

Companion memory is stored as files on your computer, not in the cloud. On the cloud plans, messages go through Sei's server to the AI model to get replies. With your own key they go straight to the provider you chose, and with Ollama they stay on your machine. Usage analytics can be turned off in Settings.

## Building from source

You need Node.js 22 and npm.

```bash
git clone https://github.com/sei-studio/sei.git
cd sei
npm install
npm run dev
```

No `.env` is needed. Sign-in, cloud companions, and cloud AI work from a plain clone through the Sei proxy. Copy `.env.example` only to point at your own proxy or Supabase project. To use your own key instead, pick a provider in Settings.

Other scripts:

| Command | What it does |
|---|---|
| `npm run dev:tools` | Dev run with DevTools and the log/prompt viewer at localhost:7077 |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Build without packaging |
| `npm run dist:mac` / `npm run dist:win` | Package for macOS or Windows |

Notes:

- `npm run dev` downloads the Live2D Cubism Core if it is missing. It is Live2D's proprietary runtime and is never committed to the repo.
- The macOS helpers (`native/mac-audio-tap` for screen audio in backseat, `native/mac-input`) are Swift and build only on a Mac. On other systems the scripts skip them.
- Game runtimes (Minecraft's mineflayer stack, the Stardew and DST helper mods) ship as game packs that the installed app downloads on first use. In dev they load from the repo.
- The Stardew Valley mod compiles only against the game's own assemblies, so its build output is checked in under `native/stardew-mod/assets/`.
- `npm run dist:linux` builds an AppImage. Linux is not an official platform: it is experimental and untested for release.

## Project layout

Sei is an Electron app with a React renderer, a main process, and a forked bot process that runs the companion's brain and game adapters (`src/bot`). Shared contracts live in `src/shared`, and the helper mods for Stardew Valley and Don't Starve Together live in `native/`. [CLAUDE.md](CLAUDE.md) is the full contributor guide: architecture, invariants, and pitfalls.

## Contributing

Help is welcome anywhere in the repo, for example:

- Better play in the supported games
- Support for new games
- Better personality and memory

Open an issue or a pull request. To get involved with the product side, write to [ouen@sei.gg](mailto:ouen@sei.gg).

## License

Sei is licensed under [AGPL-3.0](LICENSE). The Stardew Valley and Don't Starve Together helper mods (`native/stardew-mod`, `native/dst-mod/sei`) and the vendored `soulcaster` and `skin-gen` libraries are MIT. The vendored chess engine `cce-1` is AGPL-3.0.

Sei is not affiliated with Mojang, Microsoft, ConcernedApe, Klei Entertainment, or Roblox.

## Acknowledgements

**Code and design adapted in Sei** (details in [native/dst-mod/THIRD_PARTY_NOTICES.md](native/dst-mod/THIRD_PARTY_NOTICES.md) and [native/stardew-mod/THIRD_PARTY_NOTICES.md](native/stardew-mod/THIRD_PARTY_NOTICES.md))

- [FAtiMA-DST](https://github.com/hineios/FAtiMA-DST) (MIT): the Don't Starve Together mod skeleton Sei's helper is adapted from, a survivor prefab driven by an external agent over HTTP with a DoAction / keep-working behaviour tree and a perception encoder
- [DST-AICompanion](https://github.com/votus777/DST-AICompanion) (MIT): the Follow / RunAway wiring for a companion body in Don't Starve Together
- [Chat Announcements](https://github.com/gyroplast/mod-dont-starve-chat-announcements) (CC0-1.0): the QueryServer POST and response handling pattern Sei's helper uses to talk to localhost
- [Farmtronics](https://github.com/JoeStrout/Farmtronics) (MIT): the invisible shadow-Farmer pattern Sei's Stardew Valley companion body is built on
- [amarisaster/StardewValley-MCP](https://github.com/amarisaster/StardewValley-MCP) (Apache-2.0): the NPC + shadow-farmer pairing and tool-use design the Stardew companion follows
- [StardewWebApi](https://github.com/zunderscore/StardewWebApi) (MIT): the HttpListener + WebSocket server shape inside a SMAPI mod
- [StarDojo](https://github.com/StarDojo2025/stardojo) (MIT): game-thread marshalling and the observation exporters the Stardew snapshot is modeled on
- [JunimoServer](https://github.com/stardew-valley-dedicated-server/server) (MIT): the chat-box postfix the Stardew companion listens through
- [luy-0/StardewValley-MCP](https://github.com/luy-0/StardewValley-MCP) (Apache-2.0): the mod-as-listener transport and per-install token design, used as a reference
- [SMAPI](https://smapi.io) (LGPL-3.0): the Stardew Valley mod loader, downloaded from its official release at install time, never vendored; its game-folder detection logic is ported in TypeScript. Its build package `Pathoschild.Stardew.ModBuildConfig` and the bundled Harmony library are MIT
- [tldraw](https://github.com/tldraw/tldraw) agent template (MIT): the `PenAction` the Draw! companion's pen tool is adapted from

**Libraries, engines, and downloaded components**

- [mineflayer](https://github.com/PrismarineJS/mineflayer) (MIT): the Minecraft bot framework Sei's game adapter is built on
- [PrismarineJS](https://github.com/PrismarineJS) (MIT): the broader Minecraft protocol tooling that makes this possible, including minecraft-protocol, minecraft-data, mineflayer-pathfinder, and prismarine-viewer
- [Fabric Loader](https://github.com/FabricMC/fabric-loader) (Apache-2.0) and [CustomSkinLoader](https://github.com/xfl03/MCCustomSkinLoader) (GPL-3.0): downloaded by the Minecraft setup to give companions their skins, never bundled
- [skinview3d](https://github.com/bs-community/skinview3d) (MIT): the 3D skin preview
- [Stockfish](https://github.com/official-stockfish/Stockfish) via [stockfish.js](https://github.com/nmrugg/stockfish.js) (GPL-3.0): the chess engine bundled in cce-1
- [Maia Chess](https://www.maiachess.com) by CSSLab, University of Toronto ([CSSLab/maia3](https://github.com/CSSLab/maia3), AGPL-3.0): the Maia3-5M model behind the companion's human-like chess moves, used as our ONNX export and downloaded on first game
- [chess.js](https://github.com/jhlywa/chess.js) (BSD-2-Clause): chess rules and move validation
- [pixi-live2d-display](https://github.com/guansss/pixi-live2d-display) (MIT, via the lipsync-patch fork) and [PixiJS](https://github.com/pixijs/pixijs) (MIT): Live2D rendering
- [Live2D Cubism Core](https://www.live2d.com/en/sdk/) (Live2D Proprietary Software License): fetched at build time and shipped in the app as its license allows, never committed
- [Transformers.js](https://github.com/huggingface/transformers.js) (Apache-2.0) with [Whisper](https://github.com/openai/whisper) (MIT): on-device speech recognition
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache-2.0): on-device voices and speech recognition
- [Signalsmith Stretch](https://github.com/Signalsmith-Audio/signalsmith-stretch) (MIT): voice pitch shifting

**Models, voices, and data**

- [SenseVoice-Small](https://github.com/FunAudioLLM/SenseVoice) by FunAudioLLM (Alibaba) ([FunASR Model License](https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE)): on-device speech recognition
- English voice trained on [LibriTTS-R](https://www.openslr.org/141/) ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)) with [Piper](https://github.com/rhasspy/piper) (MIT), converted to ONNX
- Chinese voice trained on [AISHELL-3](https://www.openslr.org/93/) by Beijing Shell Shell Technology (Apache-2.0) with [icefall](https://github.com/k2-fsa/icefall) (Apache-2.0)

**Fonts and art**

- [Monocraft](https://github.com/IdreesInc/Monocraft) (OFL-1.1): the pixel face the Minecraft launch panel is set in
- Oswald, Rajdhani, JetBrains Mono, Noto Sans, Press Start 2P, Architects Daughter, Pixelify Sans, Fredericka the Great, and Metamorphous (OFL-1.1), and Roboto Mono (Apache-2.0): self-hosted app fonts
- Chess pieces by Colin M.L. Burnett (the "cburnett" set from [lichess](https://github.com/lichess-org/lila)), used under the GPL
- [Kenney Impact Sounds](https://kenney.nl/assets/impact-sounds) (CC0): footstep sounds
- Minecraft artwork by Mojang Studios. Movie night photo by [American Retirement Homes](https://americanretirementhomes.org/movie-nights-and-in-house-entertainment-options/) (CC licensed)

**Inspiration**

- [Project AIRI](https://github.com/moeru-ai/airi) (MIT): open-sourced digital "embodied" AI companion, which also informed the Live2D liveliness model
- [Character.AI](https://character.ai): demonstrated personalized AI characters
- [Neuro-sama](https://vedal.ai/): showed that AI can make people happy
- Hoshimachi Suisei: the GOAT

</details>
