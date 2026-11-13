# Building, packaging and signing

## Prerequisites

| | |
|---|---|
| Node.js | 20 or newer (22 recommended) |
| Java 21 | only for the local Paper test server / integration tests (Paper 26.x needs Java 25; the harness downloads one if needed) |
| Linux e2e | `xvfb` (CI) — any desktop session works locally |

The packaged application needs **nothing** preinstalled: no Java, no Node, no game installation.

```bash
npm ci
npm start            # build and run
npm run dist:linux   # → release/Vassago-<v>-linux-x86_64.AppImage
npm run dist:win     # → release/Vassago-<v>-windows-x64-setup.exe   (run on Windows)
npm run dist:mac     # → release/Vassago-<v>-mac-{arm64,x64}.dmg/.zip (run on macOS)
```

> CI builds all three platforms. On Linux it also launches the packaged application (the unpacked
> directory) and runs the end-to-end suite against it. The Windows and macOS installers are
> produced but have not been run — see `DEVELOPMENT_STATUS.md`.

Two workflows build installers:

* `.github/workflows/ci.yml`, job `package`: on every push, per OS, uploaded as workflow artifacts
  (these expire).
* `.github/workflows/release.yml`: run by hand (Actions → Release → Run workflow, with the tag, e.g.
  `v0.2.0`) or by pushing a `v*` tag. It builds all three platforms and attaches the installers
  plus `SHA256SUMS.txt` to a GitHub Release, using `docs/RELEASE_NOTES.md` as the text. The tag has
  to match the version in `package.json`, and an existing tag is never re-used for another commit.
  GitHub sometimes has no hosted macOS runner and cancels that job without running it; the workflow
  therefore tries two macOS images, publishes whatever was built, and fails if a platform is missing —
  "Re-run failed jobs" on that run then completes the same release.

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
| macOS | Gatekeeper refuses the app at first. On current macOS: System Settings → Privacy & Security → "Open Anyway" after the first attempt (right-click → Open no longer works from macOS 15 on), or `xattr -dr com.apple.quarantine /Applications/Vassago.app`. If Apple Silicon reports the app as damaged even then, run `codesign --force --deep -s - /Applications/Vassago.app` once. | Developer ID Application certificate in `CSC_LINK`/`CSC_KEY_PASSWORD`, plus notarization credentials `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. Hardened runtime and entitlements (`build/entitlements.mac.plist`) are already configured. |
| Linux | AppImage needs `chmod +x`; no signing required. On Ubuntu 23.10 / 24.04 and later, unprivileged user namespaces are restricted, so Chromium's sandbox cannot start from an AppImage: run with `--no-sandbox` (or allow user namespaces for it with an AppArmor profile). Those systems also need `libfuse2` or `--appimage-extract-and-run`. | Optional GPG signature. |

Neither workflow signs anything today. GitHub does not hand secrets to a step unless they are mapped
into its `env`, so to sign releases: add the variables above as repository secrets, map them into
the "Build installers" step of `release.yml` (`CSC_LINK: ${{ secrets.CSC_LINK }}` and so on), and
remove `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` from that step. This path has not been exercised.

## Icons

`npm run make:icon` renders the original logo to `build/icon.png`; electron-builder converts it to
`.ico`/`.icns`.
