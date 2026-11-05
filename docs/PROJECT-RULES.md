# LCoder project rules (PROJECT-RULES)

English | [中文](PROJECT-RULES.zh.md)

> This file is the single entry point for project rules. The generic discipline (red lines, task grading, commit discipline) is defined by the `task-flow` skill from dev-flow; this document records only project-specific constraints and where they land.

## 0. Project snapshot (read before starting)

- **Product**: LCoder, a specification-driven development workbench for Windows desktop, packaging the `.spec` specification library, task state machine, and agent tool-surface control as a DeepSeek Harness plugin layer.
- **Stack**: TypeScript (ESM) · Node ≥24.9 · pnpm workspaces · Cordis · React 18
- **Baseline**: DeepSeek Harness `0.2.2-alpha.2`, released 2026-10-30
- **Current main line**: MVP-0, getting the workbench running locally and closing T-02
- **Naming**: packages `@lcoder/kernel` and `@lcoder/workspace`; main branch `lcoder/main`
- **Architecture**: [UPSTREAM-BASELINE.md](../lcoder/UPSTREAM-BASELINE.md) (upstream relationship and contact surface), [architecture.md](architecture.md) (upstream architecture)

## 1. Hard red lines (project-specific · never violate)

- 🚫 Do not modify any upstream file. When a modification is genuinely required, first add the file to [contact-surface.txt](../lcoder/contact-surface.txt) and record what and why in [UPSTREAM-BASELINE.md](../lcoder/UPSTREAM-BASELINE.md) §3.
- 🚫 The task and specification YAML under `.spec` is the single source of truth for **LCoder product data**; the UI only reads it, and state-machine decisions never live in the UI. It is not this repository's development task ledger. The kernel is the only writer: a model may file a `drafting` task through `task_draft`, may create a `draft` specification entry through `spec_draft`, may write `.spec/project.yaml` through `project_draft`, and may record a `draft` proposal through `proposal_draft`; it may not advance task state, sign a contract, approve a proposal, or edit a specification entry that already exists.
- 🚫 The target platform is Windows desktop; handle paths Windows-first (drive letters, backslashes, case-insensitive).
- 🚫 `contract_sign`, `task_bind`, `task_contract` and `proposal_approve` are never registered as model tools: they sign a contract, claim a task for a session, advance a signed task from `drafting` to `contracted`, and accept a proposal. Only a human may invoke them and `by: agent` is invalid. They live on the human-command surface, and P3 invalidates a signature whose hash no longer covers the contract body.
- 🚫 Git goes as far as a local commit. `git_commit` stages only the paths it is given and never amends or skips hooks; **there is no push tool and no `git push` in `cmd_run`'s registered surface** — publishing stays a human action, as does `git reset --hard` and any force operation.
- 🚫 Prefer adding over modifying; upstream changes touch only the assembly layer (patch layer, aggregate tsconfig), never component internals.
- 🚫 Every new contact point requires human review; `upstream-diff.sh` reports conflicts but cannot judge how deep a change goes.
- ✅ Every specification entry needs a source and a code binding; an entry without a source may not be `confirmed`.

## 2. Directory placement

| What you create | Where it goes |
|---|---|
| Specification entries | `.spec/spec/rules.yaml` |
| State-machine definitions | `.spec/spec/states/*.yaml` |
| Product task data (LCoder runtime) | `.spec/tasks/T-xx.yaml` |
| Product task contracts | `.spec/contracts/<ID>.contract.yaml` |
| Product proposals (options, recommendation, decision) | `.spec/proposals/P-<nn>.yaml`; tasks point back with `proposal:` |
| Product task evidence | `.spec/evidence/<ID>/<name>.log` |
| Acceptance commands and environment | `.spec/env.yaml`; sensitive values go in `.spec/local.yaml`, which is not committed |
| Host plugin (agent tools) | `packages/lcoder/kernel/src/` |
| Browser-side plugin (workbench UI) | `packages/lcoder/workspace/src/client/` |
| Second-development assembly, baseline, and scripts | `lcoder/` |
| Role presets (committed assembly source) | `lcoder/desktop-profile.patch.yml`; the running copy lives in the gitignored desktop home |
| Repository governance documents | `docs/PROJECT-RULES.md`, `docs/active-context.md`, `docs/prd-and-design.md` |
| Development ledger (dev-flow) | `docs/tasks.yaml` (human-maintained, the single source of development progress) |
| Offline task board | `docs/tasks-html/index.html` (generated from `docs/tasks.yaml`, never edited by hand) |
| Package tests | `packages/lcoder/<package>/tests/` |
| Troubleshooting notebook | `lcoder/PITFALLS.md` |

- Packages live at `packages/<group>/<package>`; `pnpm-workspace.yaml` only recognizes `packages/*/*`.
- Cross-package references use package names and exports only; never import upstream internal paths.

## 3. Workflow (task grading)

### Task grading

| Grade | Scope | Required process |
|---|---|---|
| A | Contract/architecture/rule changes (`!`), milestones, releases, upstream upgrades | contract confirmation → full-chain gates → ledger entry → board update → report checklist |
| B | Ordinary feature work (1–3 files) | contract confirmation (or an internal check when already explicit) → coding → gates → one board line |
| C | Small fix ≤3 files, no contract/architecture change | fix → gates → commit; board update not mandatory (unless it touches a milestone, then batched at day end/release); the pitfalls notebook may be batched at day end |

The grade matches the `grade` field in the development ledger `docs/tasks.yaml`. The single source of development progress is `docs/tasks.yaml`; `.spec/tasks/*.yaml` is product data.

### Start process (grades A/B)

1. Read [active-context.md](active-context.md) and confirm the work matches the current focus and next step.
2. Read `docs/tasks.yaml` and `docs/PROJECT-RULES.md`; confirm the task's grade, scope, and required evidence. Read `.spec` only when developing LCoder's specification-library features; the example task `DEMO-01` is not a development task.
3. Confirm the contract in one sentence: input/output, failure boundaries, MVP boundary; when the user has explicitly authorized the scope, downgrade to an internal check.
4. Code: contract first → implementation → tests; one task touches 1–3 files; no TODO stubs.

### Completion gates (must pass)

- [ ] `pnpm typecheck` is green
- [ ] `pnpm lint` is green
- [ ] `pnpm exec vitest run packages/lcoder` is green; run the repository-wide `pnpm test` when an upstream shared surface changes
- [ ] `pnpm run test:docs` is green when documents or package READMEs change
- [ ] Development evidence: gate output is recorded in the `docs/tasks.yaml` task note or the commit message; `.spec/evidence` serves product tasks only
- [ ] When the change also touches a product task (`.spec`), verify P1/P3/P4 through the kernel; the development task itself does not write a `.spec` contract
- [ ] **Dual-source sync**: when a contract, counting rule, directory convention, failure policy, or scan scope changes, update [prd-and-design.md](prd-and-design.md) and `docs/PROJECT-RULES.md` together; changing only one is drift
- [ ] Update the development ledger: edit `docs/tasks.yaml` first, then run `python scripts/build-tasks-html.py`; `docs/active-context.md` updates only the current focus. Product data (`.spec`) follows the product process and does not enter the development ledger
- [ ] Bug fixes always update the pitfalls notebook [PITFALLS.md](../lcoder/PITFALLS.md) (four-part form, next number in sequence)
- [ ] Final report: change list plus commit instructions

### Special cases

- Upstream new release: rehearse according to [UPSTREAM-BASELINE.md](../lcoder/UPSTREAM-BASELINE.md) §4 — `pnpm install`, `pnpm build`, `pnpm exec vitest run packages/lcoder`, `./lcoder/scripts/upstream-diff.sh`; merge back to `lcoder/main` only when everything is green.
- Rule evolution: stack, directory, or process changes update the matching section of this file.
- Board growth: when `docs/active-context.md` exceeds 100 lines, archive completed history first, then consider splitting tracks.

## 4. Commit conventions

- Format: `<type>(<scope>): <summary>` ≤50 characters; destructive contract changes add `!` after the type.
- Types: feat / fix / docs / refactor / style / chore / test / build.
- Scopes: `kernel` / `workspace` / `lcoder` / `spec` / `docs`.
- Atomic commits: commit as soon as one board node is complete (1–3 files); never mix unrelated changes.
- Parallel windows: one feature line = one branch + one worktree directory; at most 3 lines in parallel; shared contract files change only on the baseline.

## 5. Dictionary index

| Document | Purpose |
|---|---|
| [active-context.md](active-context.md) | Current board (read first when starting) |
| [prd-and-design.md](prd-and-design.md) | Product and design decisions |
| `docs/tasks.yaml` | Development ledger (dev-flow, single source) |
| `docs/tasks-html/index.html` | Offline task board (generated from the development ledger, never edited by hand) |
| `.spec/spec/rules.yaml` | Product specification entries (LCoder runtime) |
| `.spec/tasks/` | Product task data (LCoder runtime, not the development ledger) |
| `.spec/contracts/` | Task contracts |
| `.spec/proposals/` | Product proposals awaiting a human decision |
| `.spec/evidence/` | Completion evidence |
| `.spec/env.yaml` | Acceptance commands and environment |
| [UPSTREAM-BASELINE.md](../lcoder/UPSTREAM-BASELINE.md) | Upstream baseline, contact surface, upgrade drill |
| [contact-surface.txt](../lcoder/contact-surface.txt) | List of modified upstream files |
| [RUN.md](../lcoder/RUN.md) | Startup and verification manual |
| [PITFALLS.md](../lcoder/PITFALLS.md) | Troubleshooting notebook (grep the pitfall number) |
| [architecture.md](architecture.md) | Upstream architecture (read before changing `packages/`) |
| [AGENTS.md](AGENTS.md) | Upstream documentation standard |

## 6. Environment notes

- **Isolation is a product constraint, not a preference.** LCoder development and verification must not depend on whether this machine has the packaged desktop app or a `dsh` install, and must not change those installs either. Every run points `DSH_HOME` at a directory inside the repository (`.dsh-home/` at the repo root, ignored; a worktree uses its own in-repo home), and desktop `userData` stays on `apps/desktop/.desktop-build/development/electron-user-data`, which `apps/desktop/scripts/dev.ts` already defaults to. Forbidden: writing `~/.dsh`, writing `AppData`, touching the registry, installing or uninstalling an application, and killing a process this session did not start.
- **On this machine the desktop profile must set `documentsDirectory`.** The Host's system-Documents lookup wedges here, which parks `workspace/initializeDefault` forever and blocks `workspace/create` behind the registry queue with no error anywhere. Measured on one code base and one in-repo home, changing only that line: without it both calls stay unanswered and `storages/workspace.json` holds at 227 bytes with `workspaceIds` empty; with it all 22 calls answer and the file grows to 758 bytes with the default workspace registered. This is a workaround for a machine-specific hang. The namespace not recovering on its own is a design characteristic (`commands.ts` declares no deadline), and whether the 10 s lookup timeout bounds the wait is unproven; see `lcoder/RUN.md` for the patch snippet.
- Node must be `>=24.9.0`; on this machine use `pnpm env use --global 24` and do not change the system Node.
- First install: `pnpm install`; before the first launch run `pnpm run build:artifacts`.
- Launch: `DSH_HOME='<repo>\.dsh-home' pnpm dsh web --patch lcoder/cordis.patch.yml --no-open --port 3080` (Git Bash needs the Windows form of the path, or the profile silently fails to resolve).
- `@lcoder/*` must be linked with `link:` into the in-repo profile (`<DSH_HOME>/profiles/web/package.json`); it is never linked into `~/.dsh`. Repeat after rebuilding the home directory.
- On Windows, killing `dev:web` does not kill child processes; clean the process tree and confirm the port is free before starting another instance.
- Do not pipe `dev:web`; redirect output to a file and read it, or the log stays buffered until the process exits.
- One desktop line per worktree: the main window keeps the default Electron inspector ports (9229/9222/9230), and a feature worktree sets `DSH_DESKTOP_MAIN_INSPECT_PORT`, `DSH_DESKTOP_RENDERER_DEBUG_PORT`, and `DSH_DESKTOP_HOST_INSPECT_PORT` to a reserved triple recorded in that task's ledger note. `apps/desktop/scripts/dev.ts` points `DSH_HOME` and Electron `userData` into `apps/desktop/.desktop-build/development/`, so a worktree never writes the main window's `~/.dsh`; leave those defaults alone — setting `DSH_HOME` to `~/.dsh` is what turns a verification run into a write against the machine's install. `@lcoder/*` links point at the worktree's own package directories.
- Plugin paths are batch combo URLs, not `plugins/<name>/client.js`; a single request returns 404.
- Documentation gate: `pnpm run test:docs`; package READMEs need the `kind` / `description` frontmatter and the `Summary` / `Table of Contents` / `Dev Note` skeleton.
- Board: edit `docs/tasks.yaml` first, then run `python scripts/build-tasks-html.py`; the artifact is `docs/tasks-html/index.html`. `.spec` does not participate in board generation.
- The upstream documentation standard requires one physical line per paragraph (`verify-md-wrap`); write new `docs/` documents the same way.
