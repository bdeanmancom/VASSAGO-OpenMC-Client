# Architecture

## Decision record: TypeScript/Electron + PrismarineJS (chosen) vs Rust/wgpu

| Criterion | A — TypeScript, PrismarineJS, three.js, Electron | B — Rust, wgpu, native UI |
|---|---|---|
| Protocol coverage today | `minecraft-protocol` + `mineflayer` + `minecraft-data` speak 1.8 → 1.21.11 and 26.1, including the 1.20.2+ configuration phase, 1.19+ chat, 1.21.5+ hashed inventory clicks. Verified in this repo against Paper 1.21.11. | No Rust library of comparable breadth and currency was available (Minosoft is Kotlin/GPL-3 and trails current releases; `azalea`/`valence` track a single version at a time). Would mean writing or porting most of the protocol + gameplay layer. |
| Time to a playable client | Days: protocol, physics, inventory, entities already exist and are MIT/BSD licensed. | Months before the first block renders. |
| Rendering performance | WebGL2 via three.js with custom shaders, texture arrays and worker-thread meshing; ample for voxel terrain. | Best possible. |
| Packaging | electron-builder → NSIS / dmg (arm64 + x64) / AppImage from one config. | Per-platform effort. |
| Maintenance when a new game version ships | Usually `npm update` + regenerate data + run the integration suite. | Re-implement protocol deltas by hand. |

**Decision:** Option A. Compatibility and upgrade speed dominate for a client whose whole purpose is to keep
talking to servers that update several times a year. The design keeps the renderer and the protocol core
behind a narrow message protocol so either side can be replaced (e.g. a native/wgpu renderer or a Rust
core) without touching the other.

### Reference projects reviewed

| Project | License | Finding |
|---|---|---|
| PrismarineJS/minecraft-protocol 1.68 | BSD-3-Clause | Packet codec + login/encryption/compression/config phase for 1.7 → 1.21.11, 26.1. **Used.** |
| PrismarineJS/mineflayer 4.39 | MIT | Client gameplay state machine (physics, inventory, entities, digging, chat). Tested upstream on 1.21.3 – 1.21.11, 26.1. **Used** as the session core. |
| PrismarineJS/minecraft-data 3.119 | MIT | Per-version protocol/registry tables. **Used** (protocol data, block states, collision shapes). |
| PrismarineJS/prismarine-physics, prismarine-chunk, prismarine-auth | MIT | **Used** transitively (movement simulation, chunk parsing, Microsoft device-code auth). |
| PrismarineJS/prismarine-viewer | MIT | Studied for technique. **Not used**: it depends on the proprietary game textures/models (via `minecraft-assets`), which this project must not ship. Vassago has its own mesher and procedural art instead. |
| Bixilon/Minosoft | GPL-3.0 | Kotlin/LWJGL client. Studied for scope only; not reused (different language, copyleft, and it loads the original game assets). |
| wiki.vg (now hosted on the Minecraft Wiki) | CC BY-SA | Protocol documentation used as reference. |

## Process model

```
┌──────────────────────────── Electron main (src/main) ────────────────────────────┐
│ window · vassago:// protocol (COOP/COEP, CSP) · config.json · logs · diagnostics │
│ safeStorage-encrypted token store · crash recovery                               │
│        ▲ IPC (contextBridge, sandboxed preload)          ▲ worker_threads        │
└────────┼─────────────────────────────────────────────────┼───────────────────────┘
         │                                                 │
┌────────┴─────────── Renderer (src/renderer) ──┐   ┌──────┴── Session worker (src/session) ──┐
│ React launcher + HUD                          │   │ GameSession: mineflayer bot              │
│ Game: three.js scene, sky, entities, input    │◄──┤ 20 TPS physics, world, inventory, chat   │
│ World: SharedArrayBuffer chunk store          │   │ version adapter · error mapping          │
│   └─► N mesher Web Workers (AO, smooth light) │   │ consent-gated resource packs · MSA auth  │
│ Procedural art: tiles, item icons             │   └───────────────────────────────────────────┘
└───────────────────────────────────────────────┘
```

* **`src/shared/protocol.ts`** is the only contract between the gameplay core and any front-end:
  `SessionCommand` (connect, controls, look, dig, use, window clicks, chat…) and `SessionEvent`
  (chunks, block updates, entity moves, inventory snapshots, health, chat, disconnects…). The
  integration tests drive `GameSession` through exactly this interface with no Electron involved.
* **Session worker** — networking is asynchronous and lives off the main thread so neither the
  window nor the renderer can stall keep-alives. Chunks are converted to flat `Uint16Array` block-state
  sections plus packed light and transferred (not copied) out of the worker.
* **Renderer** — chunk sections are stored in `SharedArrayBuffer`s (the app is cross-origin isolated)
  so mesher workers read neighbours without copies. Meshes are built per 16³ section with face
  culling, per-vertex ambient occlusion and smooth lighting from the server's light data, and are
  drawn with one opaque/cut-out and one translucent material sampling a WebGL2 texture array
  (one layer per tile, so mipmaps never bleed). Three.js frustum-culls sections; columns beyond the
  client render distance are hidden; GPU buffers are disposed when chunks unload.
* **Player movement** is simulated by the session at 20 TPS (the same cadence the server validates) and
  interpolated by the renderer; camera rotation is applied locally every frame so looking around has no
  latency.

## Protocol behaviours the client adds on top of the library

The protocol library is treated as a dependency, never edited in `node_modules`. Where its
behaviour differs from what servers expect, the difference is corrected in `src/session`:

* **Client tick end** (`src/session/tick-end.ts`). The official client ends every game tick with a
  tick-end packet (1.21.2+). mineflayer 4.39 never sends it. Servers up to 26.2 do not mind; 26.3
  disconnects a client that sends a second position packet before a tick end
  (`ServerGamePacketListenerImpl.receivedPositionThisTick`, cleared only by `handleClientTickEnd`)
  with `multiplayer.disconnect.invalid_player_movement`. The module sends tick-end once per client
  tick and guarantees a tick end between any two position packets, including during catch-up
  bursts and teleport answers, and steps aside if a future library version sends it itself.
* **Sneaking and sprinting** (`src/session/input-compat.ts`). 1.21.2 added a player-input packet;
  from 1.21.6 the server reads sneaking from it and the old sneak actions are gone, which
  renumbered the remaining entity actions. The library sends only the input packet wherever it
  exists and still writes the old action numbers. So on 1.21.2–1.21.5 a sneak never reached the
  server, and on 1.21.6+ "start sprinting" arrived as "start riding jump". The module adds the
  sneak action where the server still expects it and sends actions by name, read from the
  protocol tables of the version in use.
* **Connection attempts** (`Attempt` in `src/session/session.ts`). Each `connect()` gets a token
  that `teardown()` marks abandoned. Every `await` and every callback handed to the libraries checks
  it, because the libraries keep working after a cancel: a status ping, a DNS lookup or a Microsoft
  device-code sign-in may complete minutes later. A torn-down client is also *neutralised* — it
  destroys any socket it is handed and its connect hook is replaced — so a sign-in finished in the
  browser after the user cancelled can neither log in out of sight nor store tokens.
* **Why a server refused a private-server name** is read from the handshake: an encryption request
  in answer to an unverified login means the server (or proxy) wants a verified account, whatever
  the kick text says. Without that request, an "unverified username" message is treated as the
  server-side failure it is.
* **Resource packs** are answered only after the user consents (the library's auto-accept plugin is
  disabled).
* **Crafting on pre-1.21.5 servers**: consumed ingredients are predicted locally, as the official
  client does.
* **Sky light** missing from edge chunks is repaired on the client (`src/renderer/game/skylight.ts`).

## Servers that translate for older clients (ViaVersion / ViaBackwards)

ViaVersion answers a status ping with the pinging client's own protocol number, so a 26.3 server
(protocol 777) looks like protocol 775 to a client that pings as 26.1. The client then connects as
26.1 and ViaBackwards translates. `negotiate` in `src/session/versions.ts` reads the status name:
when it states one plain version that disagrees with the protocol number, and that number is an
echo of the one the ping was sent with, the server is translating. It is reported as
`serverVersion` and the UI shows "26.3 · joins as 26.1" — unless the server's own version is one
the client speaks, in which case that version is spoken directly, without the translation. Names
that state a range or no version prove nothing, so such servers are joinable but never shown as
verified. A 26.3 server **without** ViaBackwards cannot be joined yet: the PrismarineJS stack has
no protocol data for 777.

## Version adapter layer

`src/session/versions.ts` decides which game version to speak (status ping → protocol number → newest
matching release) and whether it is *verified*. Everything version-specific lives in data, not code:

* protocol + registries: `minecraft-data` (session side)
* block states / collision shapes / item + entity names: `resources/gamedata/<version>.json`, generated
  by `scripts/gen-blockdata.mjs` for every version the protocol stack supports
* `VERIFIED_VERSIONS` in `src/shared/protocol.ts` lists only versions that pass the integration suite.
  `VERIFIED_TRANSLATED` lists server versions verified through the server's own translation layer,
  as exact pairs (`26.3` joined as `26.1`). The UI labels everything else *experimental* and refuses
  protocols it has no data for with a clear message.

To add a version: bump the PrismarineJS packages, run `npm run gen:data`, run
`VASSAGO_TEST_VERSION=<v> npm run test:integration`, and only then add it to `VERIFIED_VERSIONS`.

## Original art

No Mojang assets are shipped or downloaded. `src/renderer/game/materials.ts` maps every block state to a
*look* (render kind, layer, six tile keys); `textures.ts` paints each 16×16 tile procedurally from
palettes and patterns; `itemicons.ts` paints item icons. Entities use simple original box models.

## Security notes

* Renderer is sandboxed with `contextIsolation`; it can only reach the main process through the small
  API in `src/main/preload.ts`. Navigation and `window.open` are blocked except for an allow-list of
  Microsoft sign-in and project URLs opened in the system browser.
* Microsoft sign-in uses the OAuth device-code flow (prismarine-auth); passwords never touch the app.
  Tokens are encrypted with the OS keychain via Electron `safeStorage`; without OS encryption they
  are kept in memory only. A stored sign-in always belongs to a listed Microsoft account: one made
  for a single attempt that never joined is discarded when its screen closes, and anything left
  without a listed account is removed at the next start.
* A private-server (offline) profile holds no account session, so it cannot pass an online-mode
  server's verification: the key exchange completes, the server's session check fails, the server
  rejects the login and the client reports why. Nothing is done to fake or skip that check.
* No telemetry, analytics, auto-update pings or background services.
