# Development status

_Last updated: 2026-11-13 · version 0.1.0_

This file is the honest ledger: what has been **verified by an automated run against a real server**,
what exists but is only partly verified, and what is missing. If it is not listed under "Verified",
do not assume it works.

## How things were verified

| Suite | Result | Environment |
|---|---|---|
| Unit (`npm test`) | 37 / 37 pass | Node 22 |
| Integration (`npm run test:integration`) | 25 / 25 pass on **1.21.11** and on **1.21.4** | PaperMC 1.21.11 (build 132) and PaperMC 1.21.4, offline-mode + online-mode profiles, Java 21, Linux x64 |
| End-to-end (`npm run test:e2e`) | 21 / 21 steps pass on 1.21.11 | Real Electron 39 app driven by Playwright under Xvfb with software GL (SwiftShader) |
| GitHub Actions | Run #2 green: typecheck, unit, integration, build, end-to-end, then installers **built** on `ubuntu-latest`, `windows-latest` and `macos-latest` | commit `37c3bb6` |
| Packaging | Linux AppImage (≈125 MB), Windows NSIS installer (≈104 MB), macOS dmg + zip for arm64 and x64 produced by CI. Only the Linux unpacked build has been **launched** (joins a server and renders). | CI artifacts |

Local runs and CI both used Linux for everything that executes the app. **No Windows or macOS build
has been launched yet, and nothing has been run on a real GPU** — see "Not verified" below.

## Verified (automated, against a real Paper server)

Connectivity
- Status ping, MOTD, player counts, latency, protocol → version negotiation
- Offline-mode ("private server") login without any Microsoft authentication
- Online-mode server correctly refuses an unauthenticated login; the client reports why and does not
  attempt to bypass it
- Resource-pack offer → user consent prompt → decline or accept both keep the session alive
- Connection refused / unknown host / unsupported version → clean error screens
- Kick with server-provided reason, manual reconnect, clean disconnect
- Logging in while dead → death screen → respawn

World and rendering
- Chunk loading/unloading, block updates, server light data, dimension change (overworld ⇄ nether)
- Worker-thread meshing with face culling, ambient occlusion, smooth lighting, liquids, partial blocks
- Sky, sun/moon, clouds, fog, day/night from server time
- Adjustable render distance, FOV, frame-rate limit, resolution scale, graphics presets, fullscreen
- Debug/performance overlay (F3)
- Original art for all 1,166 blocks (29,671 states) and 1,505 items of 1.21.11 — zero fallbacks

Gameplay
- First-person camera, mouse capture, WASD, jump, sprint, sneak; server accepts the movement
- Two players see each other (model, name tag) and each other's movement
- Chat in both directions, slash commands
- Block placing and breaking (instant in creative, timed in survival) visible to other players
- Item pickup, hotbar selection, inventory moves (click / right-click / shift-click)
- 2×2 crafting; chest container open / shift-move / close
- Using items (water bucket), attacking an entity (hurt feedback), creative flight
- Health and hunger HUD, damage feedback, death, respawn

Application
- Launcher: Play, Multiplayer Servers, Direct Connect, Profiles, Settings, About
- Saved servers with live ping, recent connections, profiles, persistent settings
- Diagnostics export (no account tokens), structured log file
- Runs with no game installation; ships no game assets

## Implemented but only partly verified

| Area | State |
|---|---|
| **Microsoft account sign-in** | Device-code flow via `prismarine-auth`, tokens encrypted with the OS keychain, custom Azure client-ID option. **Never exercised end-to-end**: no Microsoft account was available in the build environment. Only the rejection path against an online-mode server is tested. Treat as untested. |
| Versions other than 1.21.4 / 1.21.11 | Game data is generated for 1.20.2 – 26.1 and the UI marks them *experimental*. 1.20.4 was tried once with an earlier 22-test version of the suite: 19 passed (item pickup, bucket use and the self-hurt event failed). 26.1 was not tried (its server needs a newer Java than the build machine had). |
| End-to-end UI on 1.21.4 | Only the headless integration suite was run on 1.21.4; the Electron e2e run was 1.21.11 only. |
| Sky light | Servers sometimes send edge chunks with unfinished sky light; the client repairs the vertical sky column locally (unit-tested). Light that should spread sideways under overhangs in those chunks can still be too dark. |
| Creative flight | Double-tap Space toggles a simple flight mode (gravity off, vertical speed from Space/Shift). The flight mode is covered by one integration test (climb, hover, fly forward, land; the server does not correct the position); the double-tap key handling is untested, and speed/feel differ from the reference client. |
| Containers other than chests | Layouts exist for crafting table, furnace family, hopper, dispenser, shulker box and a generic grid fallback. Only the chest is tested. Furnace progress, anvil text, enchanting, brewing, villager trading and beacon UIs are **not** implemented (the slots are shown, the special controls are not). |
| Crash recovery | Renderer crash → window reloads with a notice; session-worker crash → disconnect screen with reconnect. Implemented, not fault-injection tested. |
| Sound | A handful of synthesized effects (steps, break, place, hurt, splash). No server-driven sounds, no music. |
| Entities | Players, humanoid mobs and quadrupeds use simple box models; everything else is a sized box. No animations beyond walking/swinging, no armour or held-item rendering on mobs beyond a sprite. |

## Not verified

- **Windows and macOS builds at runtime.** CI produces the installers, but nobody has installed or
  launched them. They are unsigned (SmartScreen / Gatekeeper warnings; see `docs/PACKAGING.md`).
- **Real GPU performance.** All rendering runs so far used software GL (≈10–25 fps at 5 chunks,
  1280×800). Frame rates on real hardware are expected to be far higher but are unmeasured.
- **Long sessions.** The longest continuous automated session is a few minutes.
- **Public / proxied / modded servers.** Only vanilla-behaving Paper was tested. Velocity/BungeeCord
  transfers, Forge/Fabric mod handshakes, custom payload channels and anti-cheat plugins are untested.

## Not implemented

- Applying server resource packs visually (the offer is answered with consent; nothing is downloaded)
- Biome colouring (grass/foliage/water use one colour everywhere), particles, weather effects
  (rain darkens the sky but does not fall), block-entity rendering (sign text, banners patterns, item
  frames, chest lids), maps, paintings
- Riding/vehicles, elytra, swimming animation, sleeping UI, advancements, recipe book, statistics
- Creative-mode item picker, command/tab completion, chat signing reports, clickable chat components
- Scoreboards, boss bars, tab-list header/footer, player skins (players get a generated look)
- Auto-reconnect, LAN discovery (SRV-record lookup is left to the protocol library and is untested)
- Key rebinding, controller support, localisation, auto-update

## Known issues

- Underground caves are meshed and drawn even when hidden (no occlusion culling), so triangle counts
  are high at large render distances.
- The outermost ring of loaded chunks is not meshed (a chunk needs all eight neighbours first).
- Ascending rails render flat; standing signs/banners snap to four directions.
- `minecraft-data` (MIT) is shipped as a dependency and includes English translation strings and
  registry tables derived from the game; no textures, models, sounds or code from the game are included.
- The local test harness accepts the Minecraft EULA on your behalf only when you pass
  `--accept-eula` / `MC_EULA=true`.

## Next steps

1. Sign in with a real Microsoft account against an online-mode server; fix whatever breaks; add a
   manual test checklist for it.
2. Download the Windows and macOS CI artifacts and launch them on real machines; add signing.
3. Measure on real GPUs; add cave/occlusion culling and greedy meshing if needed.
4. Run the integration + e2e suites on 1.21.5 – 1.21.9 and 26.1 and promote the ones that pass.
5. Furnace/anvil/enchanting screens, creative inventory, biome tints, sign text, particles.
6. Optional server resource-pack loading (user-consented, mapped onto the tile array).
