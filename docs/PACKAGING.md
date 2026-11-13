# Building, packaging and signing

## Prerequisites

| | |
|---|---|
| Node.js | 20 or newer (22 recommended) |
| Java 21 | only for the local Paper test server / integration tests |
| Linux e2e | `xvfb` (CI) — any desktop session works locally |

The packaged application needs **nothing** preinstalled: no Java, no Node, no game installation.

```bash
npm ci
npm start            # build and run
npm run dist:linux   # → release/Vassago-<v>-linux-x86_64.AppImage
npm run dist:win     # → release/Vassago-<v>-windows-x64-setup.exe   (run on Windows)
npm run dist:mac     # → release/Vassago-<v>-mac-{arm64,x64}.dmg/.zip (run on macOS)
```

> CI builds all three platforms. Only the Linux build has been launched and smoke-tested so far;
> the Windows and macOS installers are produced but have not been run — see `DEVELOPMENT_STATUS.md`.

Builds are produced per-OS by the `package` job in `.github/workflows/ci.yml` (Linux, Windows, macOS
runners) and uploaded as workflow artifacts.

## What goes into a package

`electron-builder` configuration lives in `package.json → build`. The package contains `dist/`
(bundled main, session worker and renderer), `resources/gamedata/` and production `node_modules`
with the unused Bedrock data tables stripped. Packages are not ASAR-packed so the session worker
thread can load its modules directly.

## Code signing

Unsigned builds work, with these caveats:

| Platform | Unsigned behaviour | To sign |
|---|---|---|
| Windows | SmartScreen shows "Windows protected your PC → More info → Run anyway". | Provide an Authenticode certificate: set `CSC_LINK` (base64 `.pfx` or path) and `CSC_KEY_PASSWORD`, or use Azure Trusted Signing (`azureSignOptions`). |
| macOS | Gatekeeper blocks the app; users must right-click → Open, or run `xattr -dr com.apple.quarantine /Applications/Vassago.app`. Apple Silicon refuses to launch completely unsigned code; if the build was not at least ad-hoc signed, run `codesign --force --deep -s - /Applications/Vassago.app` once. | Developer ID Application certificate in `CSC_LINK`/`CSC_KEY_PASSWORD`, plus notarization credentials `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. Hardened runtime and entitlements (`build/entitlements.mac.plist`) are already configured. |
| Linux | AppImage needs `chmod +x`; no signing required. On Ubuntu 24.04+ AppImages need `libfuse2` or `--appimage-extract-and-run`. | Optional GPG signature. |

In CI, add the variables above as repository secrets and remove `CSC_IDENTITY_AUTO_DISCOVERY: 'false'`
from the `package` job.

## Icons

`npm run make:icon` renders the original logo to `build/icon.png`; electron-builder converts it to
`.ico`/`.icns`.
