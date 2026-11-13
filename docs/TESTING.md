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

## Suites

| Suite | Command | What it covers |
|---|---|---|
| Unit | `npm test` | Mesher (culling, AO, liquids, partial blocks), registry/state decoding, raycast, procedural art coverage for every block and item, config/address parsing, error mapping. |
| Integration | `MC_EULA=true npm run test:integration` | Drives the headless `GameSession` against Paper in offline and online mode: status ping + version negotiation, login, chunks + light, resource-pack consent, movement accepted by the server, two players seeing each other, chat, place/break (creative and timed survival digging), inventory moves, 2×2 crafting, containers, damage/death/respawn, dimension change, kick reasons, reconnect, refused/unknown-host/unsupported-version failures. |
| End-to-end | `xvfb-run -a npm run test:e2e` | Launches the packaged-layout Electron app with Playwright, clicks through the launcher, joins the server, checks rendering, input, chat UI, block interaction, inventory/crafting/chest screens, HUD, death screen, debug overlay, kick + reconnect, diagnostics export. Screenshots land in `tests/e2e/artifacts/`. |

Set `VASSAGO_TEST_PORT` (and `VASSAGO_TEST_ONLINE_PORT`) to reuse already-running servers instead of
booting new ones — handy while iterating.

## Promoting a version to "verified"

1. `VASSAGO_TEST_VERSION=<version> MC_EULA=true npm run test:integration`
2. Run the e2e suite against a server of that version.
3. Add the version to `VERIFIED_VERSIONS` in `src/shared/protocol.ts` and record the run in
   `DEVELOPMENT_STATUS.md`.
