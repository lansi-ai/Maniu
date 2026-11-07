# LCoder desktop release

English | [中文](desktop-release.zh.md)

## 0. Purpose and authority

This document is the single source of LCoder desktop release facts: product identity, update source, update experience, the signing gap, the release process, the macOS adaptation matrix, the upstream contact surface, and the task split that implements them. Code, packaging scripts, and release configuration implement these facts; where an upstream publishing document states a different destination or identity, this document governs LCoder releases.

The development ledger remains `docs/tasks.yaml`; product data remains `.spec/`. Upstream documents under `apps/desktop/packaging/` and `apps/desktop/publishing/` stay upstream facts about DeepSeek Harness and are not restated here. All hostnames, bucket names, account IDs, and certificate subjects below are placeholders; real values live only in ignored release configuration and never in this repository.

## 1. Product identity

### 1.1 Application identity

| Field | LCoder value |
|---|---|
| Product name | LCoder |
| Windows executable | LCoder.exe |
| macOS bundle | LCoder.app |
| Application identifier | ai.lansi.lcoder |
| URL scheme | lcoder |
| Windows installation directory | %LOCALAPPDATA%\Programs\LCoder |
| macOS bundle identifier | ai.lansi.lcoder |
| Icons | the LCoder icon set already registered in the contact surface |
| Updater cache directory | lcoder-updater |
| Copyright line | Copyright © LCoder |

The application identifier is supplied through `LCODER_APP_ID`, which maps to the existing `DSH_DESKTOP_APP_ID` input. The product name, protocol name, and artifact prefix are LCoder defaults in the packaging configuration; they are not per-machine settings. The Windows installer, Start Menu entry, uninstall entry, About panel, macOS bundle name, and Dock label all derive from the same product name, so changing it in one place changes every visible identity.

### 1.2 Version scheme

LCoder release versions are independent of the upstream baseline `0.2.2-alpha.2`. Source manifests keep the upstream version so an upstream sync does not conflict on version lines; the release version is supplied at packaging time through `LCODER_RELEASE_VERSION` and becomes the installed application version, the artifact version, and the feed version. LCoder starts at `0.1.0`.

The following forms are the only accepted release versions:

```
0.1.0
0.1.1
0.1.1-nightly.20261106.1
```

The stable channel accepts only a version without a prerelease suffix. The nightly channel accepts a stable version or a prerelease version. A version is never reused and never decreases within one channel. The channel is embedded at packaging time; an installed application keeps its channel and does not switch, so moving from nightly to stable requires installing the stable package.

The About panel and the settings update section show the installed release version, the upstream base version, and the packaged commit when one is recorded. A build without a recorded commit shows the release version only.

### 1.3 User data, logs, and migration

| Platform | Application data | Logs |
|---|---|---|
| Windows | %APPDATA%\LCoder | %APPDATA%\LCoder\logs |
| macOS | ~/Library/Application Support/LCoder | ~/Library/Logs/LCoder |

LCoder starts with fresh application data. It does not migrate, copy, rename, or delete DeepSeek Harness data, `~/.dsh`, or any machine-level installation. Developers keep using the repository-local home and the repository-local Electron user data described in [PROJECT-RULES.md](PROJECT-RULES.md); a development launch therefore never writes the installed application's directories.

Crash reports, plugin operation records, the update journal, and the locale cache live under the application data directory. A manual copy from an old DeepSeek Harness directory is unsupported and unverified; it is not part of any release instruction.

### 1.4 Deep links and single instance

- The only supported deep link is `lcoder://open`; it focuses the primary window or creates it when the application has no window.
- Unknown `lcoder://` paths also focus the primary window and never execute an argument, open a URL, or start a task. Task-specific routing is reserved and not implemented.
- Windows and Linux deliver a later launch through the second-instance argument list; macOS delivers it through `open-url`. Both paths converge on one handler, and an `open-url` event that arrives before startup finishes is buffered and replayed once the window exists.
- The single-instance lock remains the first lifecycle step. A second process exits after forwarding its arguments, and only the owning process reads or writes application data.

## 2. Update source

### 2.1 COS and CDN destinations

| Item | Value |
|---|---|
| COS bucket | lcoder-download-0000000000 (placeholder) |
| COS region | ap-shanghai (placeholder) |
| Public origin | https://download.example.com (placeholder) |
| Production object prefix | lcoder-desk/ |
| Test object prefix | lcoder-desk/&lt;release-id&gt;/ |
| Targets | win-x64, mac-arm64, mac-x64 |

The public origin is HTTPS only. The bucket is private to release operators; clients read the CDN origin, never a COS endpoint. Test and production use separate credentials. An upload reads credentials only after it has validated the completed package record, target, version, filenames, sizes, and SHA-512 values.

### 2.2 Object layout

```
lcoder-desk/feeds/win-x64/nightly.yml
lcoder-desk/feeds/win-x64/latest.yml
lcoder-desk/feeds/mac-arm64/nightly-mac.yml
lcoder-desk/feeds/mac-arm64/latest-mac.yml
lcoder-desk/feeds/mac-x64/nightly-mac.yml
lcoder-desk/feeds/mac-x64/latest-mac.yml
lcoder-desk/bin/<target>/lcoder-<version>-<os>-<arch>.<ext>
lcoder-desk/latest/lcoder-latest-windows-x64.exe
lcoder-desk/latest/lcoder-latest-macos-arm64.dmg
lcoder-desk/latest/lcoder-latest-macos-x64.dmg
lcoder-desk/<release-id>/feeds/<target>/*
lcoder-desk/<release-id>/bin/<target>/*
```

- Release artifacts are named `lcoder-<version>-<os>-<arch>.<ext>`, where the operating system is `win` or `mac`. Windows publishes an NSIS `.exe`; macOS publishes a DMG for installation and a ZIP for updates.
- Windows and macOS ZIP update payloads carry a `.blockmap` beside them. The DMG is not an update payload and carries no blockmap.
- A test release ID is 32 lowercase hexadecimal characters. It stays fixed through packaging, upload, retries, and upgrade testing; installed test clients keep that feed and do not discover a new ID.
- A production release never deletes older version objects. Keeping them makes a feed rollback possible without rebuilding.

### 2.3 Channels

| Channel | Accepted versions | Audience | Feed files |
|---|---|---|---|
| latest | stable only | internal stable testers, then public after T-82 | latest.yml, latest-mac.yml |
| nightly | stable or prerelease | internal test | nightly.yml, nightly-mac.yml |

The channel is sealed into the installed application. `allowPrerelease` is enabled only for nightly, `allowDowngrade` is always false, and a latest feed that contains a prerelease is rejected before upload. A nightly build never becomes a stable release by renaming a feed; promotion packages the same source as a stable version and publishes a new artifact.

### 2.4 Packaged app-update.yml

```
provider: generic
url: https://download.example.com/lcoder-desk/feeds/win-x64/
channel: nightly
updaterCacheDirName: lcoder-updater
```

Each package embeds one generic provider whose URL is that target's feed directory and whose channel is the installed channel. Windows receives the file from electron-builder; macOS receives it before signing and verifies it after packing. A package without this file reports that no update source is configured instead of checking a default server. Unsigned packages omit the file by default; the experimental opt-in described in §4 is the only exception.

### 2.5 Environment variables

| LCoder variable | Internal variable | Purpose |
|---|---|---|
| LCODER_APP_ID | DSH_DESKTOP_APP_ID | Application identifier |
| LCODER_UPDATE_ENV | DSH_DESKTOP_AUTO_UPDATE_ENV | Select test or production destination |
| LCODER_UPDATE_CHANNEL | DSH_DESKTOP_UPDATE_CHANNEL | Select latest or nightly |
| LCODER_RELEASE_VERSION | DSH_DESKTOP_RELEASE_VERSION | Independent LCoder release version |
| LCODER_UPDATE_ORIGIN | DOWNLOAD_TEST_ORIGIN or DOWNLOAD_PROD_ORIGIN | Public origin of the selected deployment |
| LCODER_UPDATE_PREFIX | DSH_DESKTOP_UPDATE_PREFIX | Object prefix, `lcoder-desk` by default |
| LCODER_DOWNLOAD_BUCKET | DOWNLOAD_TEST_COS_BUCKET or DOWNLOAD_PROD_COS_BUCKET | Selected COS bucket |
| LCODER_DOWNLOAD_SECRET_ID | DOWNLOAD_TEST_COS_SECRET_ID or DOWNLOAD_PROD_COS_SECRET_ID | Selected COS SecretId |
| LCODER_DOWNLOAD_SECRET_KEY | DOWNLOAD_TEST_COS_SECRET_KEY or DOWNLOAD_PROD_COS_SECRET_KEY | Selected COS SecretKey |
| LCODER_DOWNLOAD_RELEASE_ID | DOWNLOAD_TEST_RELEASE_ID | Test release directory |
| LCODER_DOWNLOAD_EO_ZONE_ID | DOWNLOAD_PROD_EO_ZONE_ID | Production CDN purge zone |
| LCODER_PRODUCT_NAME | DSH_DESKTOP_PRODUCT_NAME | Product name and bundle name |
| LCODER_PROTOCOL_SCHEME | DSH_DESKTOP_PROTOCOL_SCHEME | Deep-link scheme |
| LCODER_UNSIGNED_UPDATER | DSH_DESKTOP_UNSIGNED_UPDATER | Embed the feed in an unsigned package (§4.1) |

The LCoder names are the release configuration contract. One alias step in the package environment loader maps them onto the internal names that upstream scripts already read, so the rest of the packaging code keeps its existing inputs. The same step supplies the LCoder product name, application identifier, deep-link scheme, artifact prefix, fixed-download name prefix, object prefix, updater cache directory, and release tag prefix, which `apps/desktop/scripts/desktop-product-identity.mjs` owns; a release environment that declares none of these internal names keeps the upstream identity. The target dotenv files use the LCoder names; real secrets never enter the repository. The internal names stay internal and are not a second public contract.

### 2.6 Cache, upload, and rollback

- Upload binaries and blockmaps before the channel YAML, and upload the YAML last. A feed never points at an object that is not yet readable.
- Feeds and fixed-download metadata must be served uncached; binary objects and blockmaps may be cached for one year as immutable content. Cache policy belongs to the COS bucket and CDN configuration, because the uploader deliberately leaves `Cache-Control` unset.
- Production fixed downloads and a rollback feed require a CDN purge submission after upload. Submission acceptance is not completion; the release operator checks the CDN task history before announcing the release.
- A feed rollback republishes the previous YAML that references the previous binaries. A fixed-download rollback re-uploads the older installer to the fixed object. Neither operation deletes objects.
- Clients never downgrade. A rollback protects users who have not updated yet; users already on the newer version receive a higher hotfix version instead.
- Withdrawing a test batch requires deleting its release directory and purging that CDN directory. Format validation of a release ID proves nothing about randomness; use a secure random generator.

## 3. Update experience

### 3.1 Automatic and manual checks

- After the first window is visible and the workspace is ready, LCoder waits 20 seconds plus a random 0 to 10 seconds before the first automatic check. This keeps startup traffic and the first paint apart.
- Automatic checks repeat every 6 hours, with exponential backoff up to 1 hour after a failed check. Foregrounding the application or resuming from sleep joins the same deadline instead of starting a parallel request.
- The settings page and the application menu both offer a manual check. A manual request bypasses the deadline, joins an in-flight check, and makes a failure visible.
- No check starts while a download or an installation is in progress, and closing the application does not cancel a user-visible error report.

### 3.2 States

| State | Display | Available action |
|---|---|---|
| idle | Current version, last check result | Check now |
| checking | Checking indicator | None; the request joins the in-flight check |
| available | New version number and release channel | Download with confirmation |
| downloading | Percentage and transferred size | Cancel is owned by the native prompt |
| verifying | Preparing the downloaded package | None |
| ready | Version ready to install; restart required | Install and restart with confirmation |
| error | Operation, classified reason, expandable technical details | Retry the failed operation |
| unsupported | No update source; unsigned or development build | Manual download instructions |

### 3.3 Rules

- Installation is never silent. `autoDownload` and `autoInstallOnAppQuit` stay false; the user confirms the download and separately confirms the restart.
- An automatic check failure stays silent except for a small status indicator; a manual check failure opens a dialog with a localized summary and expandable technical details.
- Network failures are classified separately from feed, download, and installation failures, so an offline machine shows an offline message rather than a broken-package message.
- The installed channel and version are always visible. The UI never offers a channel switch, because changing the feed under an installed application is not a supported upgrade path.
- An unsigned internal build reports that automatic updates are unavailable and points to the manual download location. It never claims that an unsigned update is verified.
- Mandatory update policy from the upstream desktop shell remains a separate, server-driven surface. It does not enable silent installation and it is not the LCoder release channel.

## 4. Signing gap

### 4.1 Windows unsigned

- An unsigned NSIS installer and executable carry no Authenticode signature. Windows SmartScreen shows an unknown-publisher warning, and some managed machines block the download or the launch by policy.
- The installer is per-user and does not require elevation, so an unsigned build can still install and run after the user accepts the warning.
- Update packages are checked against the SHA-512 values in the feed, not against a code signature. The mechanism may install an unsigned update, but this repository has not accepted that path and does not promise it.
- An internal experiment may set `LCODER_UNSIGNED_UPDATER=1` to embed the feed in an unsigned package. The flag is off by default, is not a supported distribution path, and leaves both platforms' update results unverified.
- An unsigned Windows build is an internal test artifact. It is not a public distribution artifact and must not be presented as one.

### 4.2 macOS unsigned

- An unsigned macOS build uses an ad-hoc signature. After download, Gatekeeper attaches the quarantine attribute and refuses a normal first launch with the unidentified-developer message.
- Opening the application from a DMG can trigger App Translocation, so the application runs from a randomized read-only path. An update cannot replace that copy; the user must move the application to `/Applications` first.
- The user can bypass Gatekeeper with the Finder Open command or by removing the quarantine attribute, but the release instructions must state the security consequence and must not present the build as notarized.
- Squirrel.Mac compares code signatures when it applies an update. An ad-hoc signature changes from build to build, so an unsigned macOS automatic update is expected to fail or to be rejected. This path is unverified and is not promised.
- An unsigned macOS build is an internal test artifact. It is not a public distribution artifact, and T-82 owns the Developer ID and notarization work that makes public distribution possible.

### 4.3 Exit condition T-82

- Windows requires a code-signing certificate, Authenticode signing of the installer and executable, and a verified publisher name in the update metadata.
- macOS requires a Developer ID Application certificate, hardened runtime, notarization, and a stapled ticket on the distributed DMG and application.
- Acceptance requires `codesign --verify --deep --strict`, `spctl -a -vv`, `xcrun stapler validate`, a clean first launch on a quarantined download, and a successful update from the previous signed version.
- Until T-82 closes, every LCoder build is internally distributed only, and the settings page must say so.

## 5. Release process

### 5.1 Pre-release gates

- `pnpm typecheck`, `pnpm lint`, `pnpm exec vitest run packages/lcoder`, `pnpm run build`, and `pnpm run test:docs` are green on the release commit.
- A clean Windows machine and a clean macOS machine install the candidate and open a repository, run one conversation, and run one registered command.
- The previous released version updates to the candidate on the same channel, or the release note states that the update path was not exercised.
- The feed files, blockmaps, SHA-512 values, and fixed downloads are read back from the public origin before announcement.
- The package record names the source commit and whether the checkout was dirty; a dirty package is never published to latest.

### 5.2 Release steps

1. Choose the channel and a release version, then record both in the release history before packaging.
2. Build the artifact for one target with the LCoder build version and the target channel; do not reuse an artifact built for another channel.
3. Sign and notarize when T-82 is available; otherwise mark the artifact unsigned and internal-only.
4. Package the DMG for installation and the ZIP for macOS updates, or the NSIS executable for Windows, and keep the blockmap beside the update payload.
5. Upload binaries, blockmaps, and then the channel YAML; verify each public URL and the feed contents.
6. Install the published artifact on a clean machine and complete one update from the previous version when the channel already has users.
7. Publish or repoint the fixed download last, submit the production CDN purge, and tag the release after the public readback succeeds.

### 5.3 Rollback

- Republish the previous channel YAML and verify that it still references readable binaries; keep the newer objects in place.
- Repoint the fixed download to the previous installer and submit the CDN purge for that URL.
- Do not delete the failed release. It is evidence for the next fix and it preserves the option to diagnose an installed client.
- Installed clients on the newer version cannot downgrade. Publish a higher hotfix version; the rollback only serves clients that have not updated yet.

## 6. macOS adaptation matrix

| Area | Required change | Files | Acceptance |
|---|---|---|---|
| Native window chrome | Keep `hiddenInset` traffic lights, reserve left clearance in the LCoder top bar, hide the Windows window-button cluster, keep drag regions and double-click zoom | apps/desktop/src/main.ts, apps/desktop/src/preload-app.ts, packages/lcoder/workspace/src/client/shell/Shell.tsx, Shell.module.css, window-chrome.ts | Screenshot shows traffic lights clear of the brand and project picker; drag, double-click zoom, and fullscreen work |
| Application menu | Keep the macOS application, File, Edit, and Window menus; remove Windows-only entries; localize every label | apps/desktop/src/main.ts, apps/desktop/src/locale.ts | Menu snapshot tests pass; manual menu review shows no Windows-only item |
| Dock and tray | Ship no menu-bar tray on macOS; the Dock icon and Dock reopen are the return path; close keeps the application alive | apps/desktop/src/main.ts, apps/desktop/resources/icon-macos.png | Dock icon is LCoder; closing the last window leaves the application running; Dock click reopens it |
| Keyboard shortcuts | Keep Cmd+C, Cmd+V, Cmd+A, Cmd+Z, Cmd+W, and Cmd+Q through native roles; do not advertise Ctrl-only accelerators | apps/desktop/src/main.ts, packages/lcoder/workspace/src/client/shell/Shell.tsx | Each shortcut works in a real window; labels show Cmd, not Ctrl |
| File dialogs | Use the native open-directory sheet for project selection; accept POSIX paths and no drive letters | apps/desktop/src/directory-picker.ts, apps/desktop/src/main.ts, packages/lcoder/workspace/src/client | Project picker opens a sheet and the selected path loads a repository |
| Path case and separators | Use platform path APIs; canonicalize workspace paths with the native real path before comparing; never lowercase POSIX paths globally | packages/lcoder/workspace/src/client/scheduling.ts, packages/lcoder/kernel/src (path helpers) | Opening the same repository with different casing resolves to one workspace; tests cover both separator styles |
| Shell and command execution | POSIX uses `/bin/sh`; keep registered commands POSIX-compatible; kill the whole process group on timeout so grandchild processes do not survive | packages/lcoder/kernel/src/tools/edit-tools.ts | A registered command that spawns a child leaves no orphan process after timeout |
| Profile documentsDirectory | Replace the hardcoded Windows path with an environment-provided directory that exists on both platforms; keep the Windows workaround intact | lcoder/desktop-profile.patch.yml, lcoder/scripts/start-desktop.sh, lcoder/scripts/prepare-profile.mjs, lcoder/RUN.md | Desktop startup answers workspace initialization on both systems; `storages/workspace.json` registers the default workspace |
| Git tools | Use `git -C <root>` with repository-relative paths; do not assume CRLF or a Windows Git installation | packages/lcoder/kernel/src/tools/git-tools.ts | Status, diff, and commit work in a macOS checkout without path errors |
| Fonts | Use a platform-neutral system stack before the Windows-only faces; keep Inter and Noto Sans SC for the modern preset | packages/lcoder/workspace/src/client/shell/Shell.module.css | Rendered font is PingFang SC or the system UI face on macOS; screenshots in both themes |
| Protocol registration | Register `lcoder` in the macOS bundle and route `open-url` to the single-instance handler | apps/desktop/scripts/electron-builder-config.mjs, apps/desktop/src/main.ts | `open lcoder://open` focuses a running window and also works on a cold start |
| Single instance | Forward the second launch's arguments, including a protocol URL, to the owning process | apps/desktop/src/single-instance.ts, apps/desktop/src/main.ts | A second launch creates no second window and focuses the owner |
| Data and log directories | Verify the macOS application data and log paths derived from the product name; write nothing to `~/.dsh` | apps/desktop/src/main.ts, docs/desktop-release.md | Application data appears under `~/Library/Application Support/LCoder`; logs under `~/Library/Logs/LCoder` |
| Update feed and installer formats | Use `*-mac.yml`, ZIP as the update payload, DMG for installation, and no blockmap inside the DMG | apps/desktop/scripts/package-macos.ts, desktop-auto-update-environment.mjs | Feed references the ZIP and its blockmap; a clean DMG install succeeds |
| Architecture coverage | Build arm64 and x64 with matching Electron, Node runtime, ripgrep, and Office payloads; record which architecture the build host covers | apps/desktop/scripts/package-target.ts, apps/desktop/scripts/prepare-primary-runtime.ts | Both artifacts launch; `file` and `lipo -info` show the expected architecture for bundled binaries |
| Quarantine and Gatekeeper | Document the unsigned first-launch steps, translocation, and the missing notarization; never label the build as notarized | docs/desktop-release.md, lcoder/RUN.md | A quarantined unsigned DMG follows the documented steps on a clean Mac; the limitation is visible in the UI |

## 7. Contact surface

### 7.1 Minimal-surface rules

- Reuse the existing environment-driven application identifier and publish URL instead of hardcoding LCoder values in the packaging scripts.
- Inject the product name, protocol scheme, and artifact prefix through validated environment inputs with LCoder defaults, so the upstream default behavior remains readable and one place owns the identity.
- Add one alias step that maps the LCoder environment names onto the internal names upstream scripts already read; do not rename internal variables across the release scripts.
- Keep upstream component internals and CI workflows untouched in phase 1. macOS packaging runs on the user's machine; CI publication is a later decision.
- Register every modified upstream file in `lcoder/contact-surface.txt` and in [UPSTREAM-BASELINE.md](../lcoder/UPSTREAM-BASELINE.md) §3 before the change lands.

### 7.2 Upstream files

| File | Planned change | Why it must change |
|---|---|---|
| apps/desktop/scripts/electron-builder-config.mjs | Product name, protocol, artifact prefix, updater cache directory, packaged product name, microphone description, unsigned updater opt-in | This file owns the bundle identity and the protocol registration; no plugin or profile can change them |
| apps/desktop/scripts/desktop-package-environment.mjs | Map `LCODER_*` names to internal names and supply the LCoder identity; change the local default application identifier | The target dotenv loader is the one entry point for local packaging and upload |
| apps/desktop/scripts/desktop-auto-update-environment.mjs | Read the public origin for every deployment, resolve the object prefix and fixed-download names from the product identity | This file resolves every update destination and fixed-download name |
| apps/desktop/scripts/desktop-build-version.mjs | Accept an independent LCoder release version that does not extend the upstream product version | The upstream validator forces every build version to extend `0.2.2-alpha.2` |
| apps/desktop/scripts/package-target.ts | LCoder artifact names and the macOS application path | It names the DMG and drives the target build |
| apps/desktop/scripts/package-macos.ts | LCoder bundle name and artifact base | It copies and promotes the signed application by name |
| apps/desktop/scripts/desktop-upload-plan.ts | LCoder artifact base and fixed-download key | Upload validation compares file names against the packaged release |
| apps/desktop/scripts/desktop-edgeone.ts | Pass the release environment to the fixed-download name | The purge URL has to name the same object the release uploaded |
| apps/desktop/scripts/desktop-publish-config.ts | LCoder production origin validation | The production guard currently requires the upstream download origin |
| apps/desktop/scripts/desktop-release-tag.ts | LCoder release tag prefix | Production upload tags the packaged commit |
| apps/desktop/src/main.ts | Protocol scheme, argument routing, delayed startup check, product name, update presentation fields | The main process owns protocol registration, the updater schedule, and the native window |
| apps/desktop/src/single-instance.ts | Pass the second launch's arguments to the focus callback | A protocol URL arrives through the second-instance arguments |
| apps/desktop/src/ipc.ts | Add installed version and channel to the update presentation | The LCoder settings page displays them |
| apps/desktop/src/update-presentation.ts | Project the installed version and channel | Presentation stays a pure transformation of main-process state |
| apps/desktop/src/preload-app.ts | Expose a platform marker or window bridge on macOS | The LCoder shell needs to reserve traffic-light clearance |
| apps/desktop/src/locale.ts | Update, version, unsigned, offline, and manual-check copy | The shell's visible text comes from this single desktop locale source |
| apps/desktop/.env.windows.example | LCoder variable names and the LCoder application identifier | The example is the operator's starting point |
| apps/desktop/.env.macos.example | LCoder variable names, the LCoder application identifier, and unsigned guidance | The example is the operator's starting point |
| apps/desktop/tests/main-startup.spec.ts | Protocol, startup check, and window expectations | Behavior changes must be pinned by tests |
| apps/desktop/tests/expected/about-panel.json | LCoder version and identity fields | The About panel expectation follows the identity change |
| apps/desktop/tests/expected/application-menu-en-US.json | LCoder labels and macOS menu shape | The menu fixture must match the product |
| apps/desktop/tests/expected/application-menu-zh-CN.json | LCoder labels and macOS menu shape | The menu fixture must match the product |

### 7.3 New LCoder files

| File | Purpose |
|---|---|
| apps/desktop/scripts/desktop-product-identity.mjs | One validated source for the product name, protocol, artifact prefix, and application identifier defaults |
| lcoder/releases.yaml | LCoder release history: version, channel, target, source commit, artifact digest, date, status |
| lcoder/scripts/start-desktop.sh | macOS and Linux development launcher with the repository-local home and profile setup |
| lcoder/scripts/prepare-profile.mjs | Cross-platform profile copy that resolves the documents directory and package links |
| docs/desktop-release.md | This fact source and its Chinese pair |

## 8. Task breakdown

| Task | Scope | Depends on | Acceptance |
|---|---|---|---|
| T-77 | This design package: identity, update source, UX, signing gap, release process, macOS matrix, contact surface, task split | T-76 | Documents, rules, and ledger updated; documentation gates green |
| T-78 | Identity and update source: product name, application identifier, protocol, artifact names, independent version, COS paths, environment aliases, unsigned updater opt-in | T-77 | Windows unsigned package shows LCoder identity, installs, routes `lcoder://open`, and reports the LCoder data path; real upload is not exercised |
| T-79 | Update experience: settings section, version and channel display, delayed startup check, manual check, all states, unsigned unsupported state | T-78 | Desktop screenshots of every state in both themes; logs prove the delayed check; no silent install |
| T-80 | macOS adaptation and unsigned packaging: chrome, menu, Dock, shortcuts, dialogs, paths, shell, git, fonts, protocol, data directories, arm64 and x64 DMG/ZIP | T-78 | Both architectures launch on the user's Mac; a repository opens; one conversation and one command run; limitations documented |
| T-81 | COS and CDN pipeline: paths, aliases, upload, fixed downloads, blockmaps, cache policy, purge, rollback, dry-run, tests | T-78 | Local validation and dry-run pass; a real upload is accepted on the test bucket before any production claim |
| T-82 | Windows and macOS signing and notarization: certificates, Authenticode, Developer ID, notarization, stapling, signed update from the previous version | T-80, T-81 | Clean-machine first launch and signed update pass every platform check |

## 9. Unverified boundaries

- Unsigned macOS automatic update is unverified and expected to fail or be rejected because the ad-hoc signature changes between builds. It is not promised.
- The x64 macOS artifact is unverified on Intel hardware until a real Intel Mac or a clean Rosetta environment runs it.
- Unsigned Windows automatic update is unverified; SmartScreen behavior on managed machines is unknown.
- Real COS upload, CDN caching, CDN purge, DNS, TLS, and bucket permissions are unverified until release credentials and the production origin exist.
- Signed macOS distribution is blocked on the Apple Developer ID and notarization work in T-82.
- Migrating data from a DeepSeek Harness installation to LCoder is unsupported and unverified.
- macOS microphone, screen-recording, and accessibility permission prompts are outside this design and need a real-device pass.
