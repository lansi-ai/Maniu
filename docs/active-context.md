# Activation context and task board (active-context.md)

English | [中文](active-context.zh.md)

## 01. Current sprint goal (Current Sprint Goal)

- **Version stage**: MVP-0 — get the workbench running locally.
- **Core business value**: the agent works inside the workbench against the `.spec` specification and task state machine, and every change has a contract, evidence, and reviewability.
- **Key deliverables**: the kernel mounts and registers ten tools plus the `/contract_sign` human command; the right sidebar workbench has three columns; the file projection reads tasks, rules, and contracts.

## 02. Task board (Task Board)

- **Development ledger (dev-flow)**: `docs/tasks.yaml`, human-maintained, the single source of development progress.
- **Product data (LCoder)**: `.spec/` is product example data (order commission: `DR-01`/`DR-02`, `DEMO-01`), read by the kernel and the UI; its IDs do not overlap the development ledger, and changing product data does not change development progress.
- **Offline board**: `docs/tasks-html/index.html` (double-click to open; contains overview, status board, hierarchy tree, matrix, and filters).
- **Regeneration command**: `python scripts/build-tasks-html.py`.

- **Current focus**: T-73 (task-detail trimming) and T-74 (intake result page and restart) are implemented on their branches and gated green; the board and ledger are closed. Remaining: a human click in the desktop windows and the merge/push decision.
- **Completed**: T-01 file projection; T-02 host mount; T-04 specification root and documentation gates; T-05 LCoder shell; T-06 real `.spec`/`project.yaml`/workspace-session data; T-07 project info drawer and the `.spec/project.yaml` schema; T-08 real floating conversation; T-09 README, tests, and old preset cleanup; T-56/T-57/T-58 flow engine, automation policy, and AI self-sign gates; T-59/T-60/T-61 flow UI, singleton sessions, and compaction visibility; T-66/T-67 session model switching and image/file attachments; T-73 task-detail trimming and T-74 intake result page and restart. T-03 is superseded by the shell and closed.
- **Next step**: see §04.

## 03. Key decisions and architectural context (Key Decisions & Context)

- **Key technical decisions made**:
  - The data plane uses file projection: no self-built Remote and no typert generator.
  - The tool surface is fail-closed by state; `contract_sign` never enters the model tools.
  - Mounting goes through `lcoder/cordis.patch.yml` only and never changes upstream manifests.
  - `.spec/tasks` is product data; `docs/tasks.yaml` is the development ledger; neither derives from the other, and the board is generated only from the ledger.
  - The specification root follows the session workspace (`session.header.cwd/.spec`); without a session cwd it falls back to the configured root, then to `process.cwd()/.spec`.
  - The LCoder shell direction is approved: project switch + task board as the first screen; a task opens a conversation with the dev-flow startup prompt; during the modification phase the main window becomes a floating conversation window while the task board window stays; only Settings is retained.
  - The shell occupies the `lcoder-home` main panel by default; `shell: false` falls back to the old right-sidebar workbench tab. The desktop profile disables `ui-sidebar` so the shell's own left rail is the only navigation.
  - Project info lives in `.spec/project.yaml`; password and token fields store only references (`passwordRef`). The drawer masks them by default and the eye reveals a locally resolved value, never committed and never sent to the model.
  - The shell reads real tasks/rules from the session workspace's `.spec` and project info from `.spec/project.yaml`. The project picker's "Open repository" creates or reuses a workspace and a session so a new repository can be read without leaving the shell.
  - The floating conversation sends the startup prompt through the session controller and renders real user/assistant text from the session event window; the input continues the same session. Kernel `file_read`/`file_edit` use the repository root while `env.yaml` and evidence stay under `.spec`.
  - The desktop profile's LCoder preset now mounts `@lcoder/kernel`; the old WorkBuddy package link is cleanup in T-09.
- **Risks and technical debt**:
  - The contract-signing channel is not implemented; P3 requires writing YAML by hand.
  - `task_transition` has no tool entry.
  - The product example `DEMO-01` is in `drafting` with no contract; the example `env.yaml` is in place.
  - The edit tools still resolve `file_read` / `file_edit` against the specification root; the real-repository acceptance step must confirm whether they should use the repository root.
  - The desktop profile still links the old `WorkBuddy/LCoder` package alongside the current `@lcoder/*` packages; the old preset can be removed once the shell is the only LCoder surface.
  - The floating conversation renders final user/assistant text, not the full DSH conversation UI (tool cards, live token streaming).
  - `.spec/local.yaml` is absent in the demo repo, so the drawer's eye shows 未配置; the local resolution path is implemented but unexercised.
  - The task board reads the first session in the selected workspace; a task-specific session per task is deferred.
  - Desktop `Open repository` never returns: `ctx.workspaces.create` stays pending while the workspace list reads fine, so no workspace or session can be created in a fresh desktop home (T-12). This blocks T-10's desktop acceptance and M0.4.
  - The kernel loads twice in the desktop profile, once under `preset-lcoder` and once under the `lcoder-kernel` insert; the boot log prints the ten-tool line twice.
  - The real run drafted `.spec/contracts/DEMO-01.contract.yaml` (unsigned, untracked); keep or discard is a product decision.

## 04. Next immediate actions (Next Immediate Actions)

- **Currently working on**: T-73/T-74 closure. T-73 removes the role row and the schedule-reasoning block from task detail and limits the signing hint to existing contracts; T-74 adds a standalone intake result page (latest proposal, drafted tasks, project info) and a restart action that lists existing artifacts before creating a new session with the same intake tier. Gates: typecheck client, vitest 52 files / 546 tests, oxlint 0, test:docs 21, i18n 1282 files, workspace bundle. Evidence: branches `lcoder/t73-task-detail` and `lcoder/t74-intake-result`, screenshots under each worktree's evidence directory, synthesized clicks only.
- **About to execute**: a human click in the desktop windows to confirm both paths without CDP, then the merge/push decision for the two branches and the commits on `lcoder/main`.
- **Open decisions**: whether to persist intake-tier detection so the result page restart works after an app restart without first opening the intake chat.
- **Development evidence**: gate output is recorded in the task note in `docs/tasks.yaml` or the commit message; `.spec/evidence` serves product tasks only.
- **Board regeneration**: after a development status change, edit `docs/tasks.yaml` first, then run `python scripts/build-tasks-html.py`.
- **Documentation gates**: green after T-02 and T-04; package READMEs and bilingual pairs must stay green whenever documents change.
- **AI interaction hint**: later sessions can be told "continue with the next step in active-context.md".

## 05. Rule self-evolution maintenance

This file is a dynamic board. Whenever a development task closes or business requirements change, first edit `docs/tasks.yaml` (the development ledger), then run `python scripts/build-tasks-html.py`, and finally update the current focus in this file according to §3 of [PROJECT-RULES.md](PROJECT-RULES.md); only the current window is maintained and completed history stays in git. Product data (`.spec`) changes follow the product process and do not pass through this board. Grade C small tasks are not mandatory to record; they are closed together at day end or release.
