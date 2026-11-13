# Development status

_Last updated: 2026-11-13 · version 0.2.0_

This file is the honest ledger: what has been **verified by an automated run against a real server**,
what exists but is only partly verified, and what is missing. If it is not listed under "Verified",
do not assume it works.

## 0.2.0 in short

**The kick.** Paper 26.3 disconnected the client about one second after it spawned ("Invalid move
player packet received"). The cause is a rule that is new in 26.3: the server accepts one
position-carrying move packet per client tick, and only a *client tick end* packet starts the next
tick. The protocol library Vassago builds on never sent that packet, so its second position packet
— the once-per-second "still here" update, sent even when standing still — was the kick.
`src/session/tick-end.ts` now ends every client tick like the official client and guarantees a tick
end between any two position packets.

It was reproduced first (the local 26.3 server logged the kick one second after each login), fixed,
and verified on a local Paper 26.3 build 244 with ViaVersion/ViaBackwards 5.12.3 snapshots.
**It has not been run against the production server it was reported from** — see "Not verified".

**Found on the way** (stricter tests exposed them; both are fixed in `src/session/input-compat.ts`):
sneaking never reached 1.21.2–1.21.5 servers, and sprinting never reached 1.21.6+ servers (26.x
included), because the protocol library writes those two actions in a form the respective server
versions do not read. Neither caused a kick; other players simply never saw them and the server did
not apply them.

**Sign-in and launcher.** Disconnect reasons are classified instead of guessed; an abandoned
Microsoft sign-in can no longer show a window, connect or store tokens later; switching profile for
one connection no longer changes the default profile; profiles can be renamed.

## How things were verified

All runs: Linux x64, Node 22, loopback PaperMC servers started by `scripts/test-server.mjs`
(peaceful difficulty). "Via" means ViaVersion 5.12.3-SNAPSHOT+1119 and ViaBackwards
5.12.3-SNAPSHOT+669, pinned with checksums in `scripts/via-pins.json`.

| Suite | Server | Client speaks | Result on the final tree |
|---|---|---|---|
| Unit (`npm test`) | — | — | 99 / 99 |
| Integration (`npm run test:integration`) | Paper 26.3 build 244 + Via | 26.1 (negotiated — what the app does) | 30 / 30 |
| Integration | same server | 1.21.11 (forced) | 30 / 30 |
| Integration | same server, with an online-mode twin | 1.21.4 (forced) | 30 / 30 |
| Integration | Paper 1.21.11 | 1.21.11 | 30 / 30 |
| Integration | Paper 1.21.4 | 1.21.4 | 30 / 30 |
| Integration | Paper 26.1.2 | 26.1 | 30 / 30 |
| Integration | Paper 1.21.11 + Via | 1.21.11 (the server's own version, chosen over the echoed protocol) | 30 / 30 |
| Two-player soak (`npm run test:soak`) | Paper 26.3 + Via | 26.1 | 3 minutes, no disconnect: 31 rounds, 62 movements confirmed by the other player's client, 62 chat lines, 62 blocks placed and broken, 11 chest sessions, 8 deaths and respawns |
| End-to-end (`npm run test:e2e`) | Paper 26.3 + Via | 26.1 | 22 / 22 steps |
| End-to-end | Paper 1.21.11 | 1.21.11 | 22 / 22 steps |
| End-to-end, **packaged** Linux build (`release/linux-unpacked`) | Paper 1.21.11 | 1.21.11 | 22 / 22 steps |

Longer runs made earlier the same day, on the tree before the last review fixes (same tick-end
code):

| Run | Result |
|---|---|
| Two-player soak, 11 minutes, Paper 26.3 + Via (the projects' then-latest CI builds) | No disconnect. 112 rounds of walking/jumping/sneaking, 224 chat lines, 224 blocks placed and 224 broken (each seen by the other player), 38 chest sessions, 28 deaths and respawns. 0 "Invalid move" lines in the server log. |
| Two-player soak, 6 minutes, on a production-like server: Paper 26.3 + Via + LuckPerms 5.5.71 + EssentialsX 2.22.0 + FancyNpcs 2.12.1, whitelist on, one NPC at spawn | No disconnect. 61 rounds, 122 chat lines, 122 blocks placed and broken, 21 chest sessions, 15 deaths and respawns. 0 "Invalid move" lines in the server log. |

What the integration suite proves about staying connected: its 60-second test and the soak check for
a disconnect after every step; walking is measured from the client's own position *and* from the
other player's client being told about it; jumping by height; sneaking and sprinting by what the
server tells the other player; placing and breaking by the other player's view of the block. The
end-to-end suite drives the real Electron app with Playwright under Xvfb with software GL
(SwiftShader). One end-to-end step ("health drop in the HUD") failed once in the packaged-build run:
the test looked for a one-heart drop that a peaceful server heals within a second. The test now
deals more damage; the three end-to-end runs above are from after that change.

**GitHub Actions** runs on every push: five test jobs — Paper 1.21.11 (integration + end-to-end),
1.21.4, 26.1.2, 26.3 + Via (integration, two-player soak, end-to-end), 26.3 + Via with the client
forced to 1.21.11 — then installers on Linux, Windows and macOS, and on Linux the end-to-end suite
against the packaged build. Runs #9 and #10 (earlier commits of this change) were green for every
test job — on GitHub's runners: 1.21.11 with end-to-end, 26.1.2, 26.3 + Via with soak and
end-to-end, 26.3 + Via forced to 1.21.11 — and for the Linux and Windows installers. In both, GitHub
cancelled the macOS job after 15 minutes without ever assigning it a runner; the last macOS build
that ran (run #7) produced the dmg and zip for arm64 and x64. The workflows now ask for a different
macOS image, and the release workflow tries two. The result for the commit you are looking at is
on the Actions tab; the 1.21.4 job and the packaged-build step are new in it.

An independent check of the diagnosis (server bytecode of 26.1.2 / 26.2 / 26.3, Paper's patch for
build 244, the ViaBackwards source and the protocol library, each fact-checked) reached the same
cause from four directions, and an adversarial review of the whole change produced the fixes listed
in the release notes.

## Verified (automated, against a real Paper server)

Connectivity
- Status ping, MOTD, player counts, latency, protocol → version negotiation; servers that translate
  between versions are recognised and labelled ("26.3 · joins as 26.1"), and when such a server
  runs a version the client speaks, that version is used directly
- Offline-mode ("private server") login without any Microsoft authentication
- Staying connected on Paper 26.3 through ViaBackwards, as 26.1 and with the client forced to
  1.21.11 or 1.21.4
- Online-mode server refuses an unauthenticated login; the client explains why, recognises this
  from the login handshake rather than from the wording of the kick, and does not attempt to
  bypass it
- Whitelist refusal explained as such
- A cancelled connection attempt stays cancelled (counted in real connections, not only events), a
  replaced one cannot end its replacement, and a screen that takes over the session does not see
  the previous connection's "Disconnected"
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
- Original art for every block and item of the supported data versions — zero fallbacks

Gameplay
- First-person camera, mouse capture, WASD, jump, sprint, sneak; the server accepts the movement
  and relays walking, sneaking and sprinting to other players
- Two players see each other (model, name tag) and each other's movement
- Chat in both directions, slash commands
- Block placing and breaking (instant in creative, timed in survival) visible to other players
- Item pickup, hotbar selection, inventory moves (click / right-click / shift-click)
- 2×2 crafting; chest container open / shift-move / close
- Using items (water bucket), attacking an entity (hurt feedback), creative flight
- Health and hunger HUD, damage feedback, death, respawn

Application
- Launcher: Play, Multiplayer Servers, Direct Connect, Profiles (add, rename, remove), Settings, About
- Saved servers with live ping, recent connections, persistent settings; the Play page says which
  profile it will join as
- Guided disconnect screen for an online-mode refusal (end-to-end tested)
- Diagnostics export (no account tokens), structured log file
- The packaged Linux build starts and passes the end-to-end suite
- Runs with no game installation; ships no game assets

## Implemented but only partly verified

| Area | State |
|---|---|
| **Microsoft account sign-in** | Device-code flow via `prismarine-auth`, tokens encrypted with the OS keychain, custom Azure client-ID option. The **success path has never been exercised** by the project: no Microsoft account is available in the build environment. A user reported signing in and being told the account did not own the game; the mapping behind that message was wrong (it matched any failure mentioning "profile") and has been rewritten, but the corrected path could not be re-tested with a real account either. What is tested: classification of the known failure messages (unit); the rejection by an online-mode server (integration + end-to-end); and — on the real session and protocol library, with Microsoft and the network replaced by stubs — that an abandoned sign-in opens no connection, shows no later code and stores nothing. Treat sign-in as untested against Microsoft's servers. |
| **26.3 servers** | Only through the server's own ViaVersion + ViaBackwards (the client speaks 26.1). Native 26.2 / 26.3 (protocol 776 / 777) is **not supported**: no released version of the protocol library has that data. On a 26.3 server without ViaBackwards the client reports the version as unsupported. |
| Guided screens for Microsoft-account problems | Wording and classification are unit-tested; the screens themselves have not been reached with a real account. The advice for proxies (Velocity, BungeeCord), hosting panels and login plugins is written from their documentation and source, not from runs. |
| Versions other than those in the table above | Game data is generated for 1.20.2 – 26.1 and the UI marks untested ones *experimental*. 1.20.4 was tried once with an early version of the suite: 19 of 22 passed. |
| End-to-end UI on versions other than 1.21.11 and 26.3 + Via | Not run. |
| `npm run check-server` | Run against the local servers only (offline, online-mode, 26.3 + Via, refused port): correct verdicts, and the server log shows the probe name connecting and leaving without joining. Not run against proxies or hosted servers. |
| Sky light | Servers sometimes send edge chunks with unfinished sky light; the client repairs the vertical sky column locally (unit-tested). Light that should spread sideways under overhangs in those chunks can still be too dark. |
| Creative flight | Double-tap Space toggles a simple flight mode. Covered by one integration test; the double-tap key handling is untested, and speed/feel differ from the reference client. |
| Containers other than chests | Layouts exist for crafting table, furnace family, hopper, dispenser, shulker box and a generic grid fallback. Only the chest is tested. Furnace progress, anvil text, enchanting, brewing, villager trading and beacon UIs are **not** implemented. |
| Crash recovery | Renderer crash → window reloads with a notice; session-worker crash → disconnect screen with reconnect. Implemented, not fault-injection tested. |
| Sound | A handful of synthesized effects. No server-driven sounds, no music. |
| Entities | Players, humanoid mobs and quadrupeds use simple box models; everything else is a sized box. |

## Not verified

- **The production server this fix was written for.** The build environment cannot reach it (it is
  IP-restricted, and connecting to outside hosts is not permitted from here). The acceptance run —
  two clients, 10+ minutes, moving, building, chatting, chests, death and respawn — has to be done
  by someone with access. What stands in for it is the local replica described above; its plugin
  versions were the nearest available, not the production jars, and it had no real players, no
  permission setup and no production world. `npm run check-server -- <host>` and "Export
  diagnostics" in Settings are there to help if anything differs.
- **Windows and macOS builds at runtime.** CI builds the installers and the release workflow
  attaches them to a GitHub Release, but the project has not installed or launched them. They are
  unsigned (SmartScreen / Gatekeeper warnings; see `docs/PACKAGING.md`). One user ran 0.1.0 from
  source on macOS (`npm start`) far enough to connect and be kicked by the bug fixed here. The
  AppImage *file* is not launched either — CI launches the unpacked directory it is made from, and
  the note about Ubuntu's sandbox restriction in the release notes is from reading, not from a run.
- **Real GPU performance.** All automated rendering used software GL (≈10–25 fps at 5 chunks,
  1280×800).
- **Sessions longer than 11 minutes**, and servers with more than two players.
- **Public / proxied / modded servers.** Velocity/BungeeCord transfers, Forge/Fabric mod handshakes,
  custom payload channels and anti-cheat plugins are untested.
- **Signing.** The documented way to sign the installers has never been exercised.

## Not implemented

- Native 26.2 / 26.3 protocol
- Applying server resource packs visually (the offer is answered with consent; nothing is downloaded)
- Biome colouring, particles, weather effects, block-entity rendering (sign text, banner patterns,
  item frames, chest lids), maps, paintings
- Riding/vehicles, elytra, swimming animation, sleeping UI, advancements, recipe book, statistics
- Creative-mode item picker, command/tab completion, chat signing reports, clickable chat components
- Scoreboards, boss bars, tab-list header/footer, player skins (players get a generated look)
- Auto-reconnect, LAN discovery (SRV-record lookup is left to the protocol library and is untested)
- Key rebinding, controller support, localisation, auto-update

## Known issues

- Three corrections sit on top of the protocol library rather than in it: tick ends, sneaking on
  1.21.2–1.21.5, and entity-action numbering on 1.21.6+. An upstream release that ends client ticks
  itself is expected (the change exists upstream, unreleased). `tick-end.ts` detects that and steps
  aside; the hand-over is unit-tested with a simulated library, not with the real future release.
  The sneak/sprint corrections work from the protocol tables and do nothing where the library is
  already right, but they too have only been tested against the installed library version.
- While the physics loop is paused (dead, terrain not loaded) tick ends are sent every 100 ms, not
  every 50 ms like the official client. No server rule known to the project depends on that rate.
- A cancelled Microsoft sign-in is made inert, but with a custom application ID the library keeps
  polling Microsoft in the background until the code expires (about 15 minutes).
- A proxy that advertises a version range ("1.8–26.1") is shown as experimental even when the
  server behind it is a verified version: nothing in its status response says what runs there.
- Underground caves are meshed and drawn even when hidden (no occlusion culling).
- The outermost ring of loaded chunks is not meshed (a chunk needs all eight neighbours first).
- Ascending rails render flat; standing signs/banners snap to four directions.
- `minecraft-data` (MIT) is shipped as a dependency and includes English translation strings and
  registry tables derived from the game; no textures, models, sounds or code from the game are included.
- The local test harness accepts the Minecraft EULA on your behalf only when you pass
  `--accept-eula` / `MC_EULA=true`. The Paper build it downloads is checksummed but not pinned
  ("latest" for the version) unless `--build` is given.

## Next steps

1. Run the two-client acceptance session on the production 26.3 server; fix whatever differs.
2. Sign in with a real Microsoft account against an online-mode server; add a manual checklist.
3. Launch the Windows and macOS installers on real machines; add code signing.
4. Native 26.2 / 26.3 once the protocol data is released upstream (the teleport confirmation
   changes shape there, so the tick-end rule needs care again).
5. Measure on real GPUs; add cave/occlusion culling and greedy meshing if needed.
6. Furnace/anvil/enchanting screens, creative inventory, biome tints, sign text, particles.
