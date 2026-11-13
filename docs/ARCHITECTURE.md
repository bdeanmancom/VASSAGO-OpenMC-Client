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

## Version adapter layer

`src/session/versions.ts` decides which game version to speak (status ping → protocol number → newest
matching release) and whether it is *verified*. Everything version-specific lives in data, not code:

* protocol + registries: `minecraft-data` (session side)
* block states / collision shapes / item + entity names: `resources/gamedata/<version>.json`, generated
  by `scripts/gen-blockdata.mjs` for every version the protocol stack supports
* `VERIFIED_VERSIONS` in `src/shared/protocol.ts` lists only versions that pass the integration suite.
  The UI labels everything else *experimental* and refuses protocols it has no data for with a clear message.

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
  are kept in memory only.
* Offline ("private server") mode never attempts to answer an online-mode encryption request without a
  real session; the server rejects the login and the client reports why.
* No telemetry, analytics, auto-update pings or background services.
