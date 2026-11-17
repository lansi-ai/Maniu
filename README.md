# LCoder

English | [中文](README.zh.md)

LCoder is a specification-driven development workbench for Windows and macOS: it puts a five-state task flow and the repository's `.spec` specification library in front of the agent, so every change is driven by a task, a signed contract, and recorded evidence.

## Relationship to upstream

LCoder is a desktop second-development build of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), tracked at upstream `0.2.2-alpha.2` (2026-10-30). The baseline commit, branch rules, and the upgrade drill are recorded in [UPSTREAM-BASELINE.md](lcoder/UPSTREAM-BASELINE.md).

Changes stay in the assembly layer (patch layer, desktop profile, packaging configuration) and the plugin layer (`packages/lcoder/*`); upstream component internals are not modified in principle, and the few upstream files that cannot be avoided are registered in [contact-surface.txt](lcoder/contact-surface.txt) and UPSTREAM-BASELINE.md §3 before landing. Upstream releases are developer previews with pre-stable APIs, so syncing a new upstream version can reach the plugin layer; run the drill in the baseline record and merge only with every gate green.

<a id="run"></a> <a id="run-from-source"></a>

## Run and build

Requirements are Node `>=24.9.0` (`engines` in `package.json`) and pnpm. Install dependencies once and build the artifacts before the first launch:

```sh
pnpm install
pnpm run build:artifacts
```

Launch the desktop application through the repository launcher; it stops previous instances of this checkout, builds, starts the application, and prints the tokenized address when it is ready:

```bat
lcoder\scripts\start-desktop.cmd
```

After a source change, rebuild only the changed layer with `lcoder\scripts\rebuild.cmd` (`workspace`, `kernel`, `desktop`, `profile`, or `all`). The manual [RUN.md](lcoder/RUN.md) owns the full procedure, including the repository-local `DSH_HOME`, linking `@maniu/*` into the profile, the `documentsDirectory` workaround, model credentials, and the readiness checks, and it records the Web UI debugging entry `pnpm dsh web --patch lcoder/cordis.patch.yml`. Review the [safety notice](SAFETY.md) before running the harness.

Root build and gate commands are defined in `package.json`: `pnpm run build` builds every artifact and runs the aggregate checks, `pnpm run build:check` runs those checks alone, and `pnpm run typecheck`, `pnpm run lint`, `pnpm exec vitest run packages/lcoder`, and `pnpm run test:docs` are the completion gates.

## Repository layout

| Path | Purpose |
|---|---|
| `packages/lcoder/kernel/` | Host plugin: registers the specification and task tools, selects the tool surface from task state, resolves `.spec` from the session workspace, and writes contracts and evidence through human commands that never enter the model tool surface. |
| `packages/lcoder/workspace/` | Browser-side shell plugin: project switch, five-state task board, project info drawer, floating conversation, and intake and restart entries; it reads product data and leaves writes to the kernel. |
| `lcoder/` | Second-development assembly: the patch layer, desktop profile, launch and layered-rebuild scripts, upstream baseline and contact-surface records, and the pitfalls notebook. |
| `docs/` | Project governance and product documents such as `PROJECT-RULES.md`, `active-context.md`, `prd-and-design.md`, and `desktop-release.md`, together with the inherited upstream architecture and contributor guides. |
| `.spec/` | Product example data: specification entries, the demo task, and evidence. It is product data, not the development ledger. |
| `packages/` and `apps/` | Upstream DeepSeek Harness component packages and the desktop application shell. |

## Identity and updates

The packaging configuration produces the `LCoder` application (`LCoder.exe` on Windows, `LCoder.app` on macOS) with application identifier `ai.lansi.lcoder`, the `lcoder` URL scheme, and a per-user install. The installed package registers the `lcoder` scheme, but application-side protocol routing is not implemented: an `lcoder://` address only launches or focuses an existing window without parsing its path, and the macOS `open-url` handler still matches only the upstream `dsh://open`. [desktop-release.md](docs/desktop-release.md) is the authority for identity, data and log directories, versioning, channels, and the upstream contact surface. The packaged artifact and the installed identity are not verified yet.

The update source is designed as a private COS bucket behind a public CDN origin, with per-target `latest` and `nightly` feeds and fixed downloads; clients read the CDN origin, never the bucket, and every public origin, bucket name, and credential is release configuration that never enters this repository. Real upload, CDN purge, the update settings surface, and the automatic check are not implemented or verified yet, so automatic updates are not available.

Every first-phase build is an unsigned internal test artifact. Windows shows an unknown-publisher SmartScreen warning; macOS uses an ad-hoc signature, so Gatekeeper and the quarantine attribute block the first launch until the user explicitly allows it, and opening from a DMG can run the application translocated. macOS packaging, signing, and notarization, and updating an unsigned build, are pending and unverified. Do not present any build as publicly distributable or as notarized.

## Development discipline

- [PROJECT-RULES.md](docs/PROJECT-RULES.md): red lines, task grading, directory placement, and completion gates.
- [active-context.md](docs/active-context.md): the current board and the next action.
- [docs/tasks.yaml](docs/tasks.yaml): the development ledger and the single source of development progress; the offline board is generated from it.
- [PITFALLS.md](lcoder/PITFALLS.md): numbered troubleshooting entries for this checkout (Chinese).
- [UPSTREAM-BASELINE.md](lcoder/UPSTREAM-BASELINE.md): the tracked upstream version, contact surface, and upgrade drill.
- [AGENTS.md](AGENTS.md): repository instructions for agents.

## Platform scope

The desktop targets are Windows x64 and macOS arm64 and x64. Windows is designed as a per-user install without elevation. macOS builds in the first phase are unsigned and remain internal test artifacts; the adaptation and packaging matrix is in §6 of `docs/desktop-release.md`, and the macOS development launcher and packaging are pending.

Development and verification use the repository-local `DSH_HOME` and Electron userData directories; writing the installed application's data, `AppData`, or the registry is out of scope.

## License

LCoder is distributed under the [MIT](LICENSE) license. Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); upstream copyright and license notices are retained.
