# Test environment

All gameplay tests run against a real [PaperMC](https://papermc.io) server started by
`scripts/test-server.mjs`. Servers bind to `127.0.0.1` only.

> Starting a server requires agreeing to the [Minecraft EULA](https://aka.ms/MinecraftEULA).
> The harness refuses to start unless you pass `--accept-eula` or set `MC_EULA=true`.
> Paper downloads Mojang's server jar itself at first start; nothing from it is redistributed here.

## Server profiles

| Profile | Command | Purpose |
|---|---|---|
| Private / offline mode | `npm run test-server -- --accept-eula --port 25570` | Main gameplay target. `VassagoOp` is pre-registered as operator. |
| Authenticated / online mode | `npm run test-server -- --accept-eula --online --flat --port 25571` | Verifies that unauthenticated logins are rejected and reported cleanly. A real Microsoft account is needed to go further. |
| Other protocol versions | `npm run test-server -- --accept-eula --version 1.21.4` | Any Paper version; pair with `VASSAGO_TEST_VERSION=1.21.4 npm run test:integration`. |
| Resource-pack prompt | add `--resource-pack <url>` | Makes the server offer a pack so the consent flow can be tested. |
| Newer server behind ViaBackwards | `npm run test-server -- --accept-eula --version 26.3 --via --port 25572` | Paper 26.3 with ViaVersion + ViaBackwards. The builds are pinned and checksummed in `scripts/via-pins.json` so every run tests the same jars; `--via-latest` takes the projects' newest CI builds instead (unpinned). The client joins as 26.1. Paper 26.x needs Java 25; the harness downloads a Temurin JDK 25 into `.test-server/jdk/` when the Java on `PATH` is older. `--build <n>` pins a Paper build, `--plugin <jar or https url>` adds more plugins, `--difficulty peaceful` keeps mobs out (the suites start their servers that way). |

## Suites

| Suite | Command | What it covers |
|---|---|---|
| Unit | `npm test` | Mesher (culling, AO, liquids, partial blocks), registry/state decoding, raycast, procedural art coverage for every block and item, config/address parsing, error mapping. |
| Integration | `MC_EULA=true npm run test:integration` | Drives the headless `GameSession` against Paper in offline and online mode: status ping + version negotiation, login, chunks + light, a 60-second keep-connected run (standing still, walking, jumping, sneaking, placing, breaking), whitelist refusal, resource-pack consent, movement accepted by the server, two players seeing each other, chat, place/break (creative and timed survival digging), inventory moves, 2×2 crafting, containers, damage/death/respawn, dimension change, kick reasons, reconnect, refused/unknown-host/unsupported-version failures. |
| End-to-end | `xvfb-run -a npm run test:e2e` | Launches the real Electron app with Playwright (the built source tree, or a packaged build via `VASSAGO_APP_PATH`), clicks through the launcher, joins the server, checks rendering, input, chat UI, block interaction, inventory/crafting/chest screens, HUD, death screen, debug overlay, kick + reconnect, diagnostics export. Screenshots land in `tests/e2e/artifacts/`. |

Set `VASSAGO_TEST_PORT` (and `VASSAGO_TEST_ONLINE_PORT`) to reuse already-running servers instead of
booting new ones — handy while iterating. The soak test (and the harness helpers it uses) send
vanilla commands spelled `/minecraft:give` and so on, so it also runs on a server where a plugin
such as EssentialsX replaces `/give`, `/tp` or `/gamemode`. The integration and end-to-end suites
use the plain spellings and need a server without such plugins.

`VASSAGO_APP_PATH=<path to a packaged executable>` makes the end-to-end suite drive a packaged
build instead of the source tree; CI does this for the Linux package
(`release/linux-unpacked/vassago-client`). Without it the suite builds the source tree first, so
its result describes the current source (`VASSAGO_E2E_NO_BUILD=1` skips that; the generated
game-data tables are only created when missing — run `npm run gen:data` after changing the
generator or bumping `minecraft-data`). On Linux
the test driver starts Electron with Chromium's sandbox switched off, in CI too.

The suites switch a reused server to peaceful difficulty and turn its whitelist off before the
second test player joins. To soak-test a server that is *meant* to be whitelisted (with
`VassagoOp` and `VassagoBob` on the list), set `VASSAGO_TEST_KEEP_WHITELIST=1`.

To run every suite against the ViaBackwards profile:

```bash
export MC_EULA=true VASSAGO_TEST_VERSION=26.3 VASSAGO_TEST_VIA=1 VASSAGO_TEST_CLIENT_VERSION=26.1
npm run test:integration
VASSAGO_SOAK_MINUTES=10 npm run test:soak
xvfb-run -a npm run test:e2e
```

`VASSAGO_TEST_CLIENT_VERSION` is the version the client is expected to negotiate (26.1 here,
because the server translates). The app always negotiates; to check an *older* protocol through
the same server, add `VASSAGO_TEST_FORCE_VERSION=1.21.11` (or `1.21.4`), which makes every test
client speak that version instead. `npm run test:soak` is a two-player session — moving, building, chatting,
using a chest, dying and respawning — that fails if either player is ever disconnected.
`VASSAGO_SOAK_SECONDS` (default 60) sets the length of the single-player keep-connected test inside
the integration suite.

## Promoting a version to "verified"

"Verified" means the headless integration suite passes against a real server of that version, in
CI, on every push. The end-to-end suite additionally runs on 1.21.11 and on the 26.3 + Via profile.

1. `VASSAGO_TEST_VERSION=<version> MC_EULA=true npm run test:integration`
2. Add a leg for it to the matrix in `.github/workflows/ci.yml`.
3. Add the version to `VERIFIED_VERSIONS` in `src/shared/protocol.ts` and record the run in
   `DEVELOPMENT_STATUS.md`.

A server version the client cannot speak itself, reached through the server's ViaBackwards, goes
into `VERIFIED_TRANSLATED` instead (`{ server: '26.3', as: '26.1' }`) after the same suites pass
on that profile. Only that exact pair is then shown as verified.

## What the suites cannot tell you

They run against loopback Paper servers started by the harness. They say nothing about a
particular production server: its plugins, its proxy, its network path. After a protocol-level fix,
someone with access still has to join the real server and play on it.
