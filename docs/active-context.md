# Activation context and task board (active-context.md)

English | [中文](active-context.zh.md)

## 01. Current sprint goal (Current Sprint Goal)

- **Version stage**: MVP-0 — get the workbench running locally.
- **Core business value**: the agent works inside the workbench against the `.spec` specification and task state machine, and every change has a contract, evidence, and reviewability.
- **Key deliverables**: the kernel mounts and registers nine tools; the right sidebar workbench has three columns; the file projection reads tasks and rules.

## 02. Task board (Task Board)

- **Development ledger (dev-flow)**: `docs/tasks.yaml`, human-maintained, the single source of development progress.
- **Product data (LCoder)**: `.spec/` is product example data (order commission: `DR-01`/`DR-02`, `DEMO-01`), read by the kernel and the UI; its IDs do not overlap the development ledger, and changing product data does not change development progress.
- **Offline board**: `docs/tasks-html/index.html` (double-click to open; contains overview, status board, hierarchy tree, matrix, and filters).
- **Regeneration command**: `python scripts/build-tasks-html.py`.

- **Current focus**: T-04 specification root (doing), together with T-02's documentation gate.
- **Completed**: T-01 file projection.
- **Next step**: see §04.

## 03. Key decisions and architectural context (Key Decisions & Context)

- **Key technical decisions made**:
  - The data plane uses file projection: no self-built Remote and no typert generator.
  - The tool surface is fail-closed by state; `contract_sign` never enters the model tools.
  - Mounting goes through `lcoder/cordis.patch.yml` only and never changes upstream manifests.
  - `.spec/tasks` is product data; `docs/tasks.yaml` is the development ledger; neither derives from the other, and the board is generated only from the ledger.
  - The specification root follows the session workspace (`session.header.cwd/.spec`); without a session cwd it falls back to the configured root, then to `process.cwd()/.spec`.
- **Risks and technical debt**:
  - The contract-signing channel is not implemented; P3 requires writing YAML by hand.
  - `task_transition` has no tool entry.
  - The product example `DEMO-01` is in `drafting` with no contract; the example `env.yaml` is in place.
  - The edit tools still resolve `file_read` / `file_edit` against the specification root; the real-repository acceptance step must confirm whether they should use the repository root.

## 04. Next immediate actions (Next Immediate Actions)

- **Currently working on**: T-04, making the specification root explicit per session and converging the three documentation contradictions.
- **About to execute**: run `pnpm typecheck` / `pnpm lint` / `pnpm exec vitest run packages/lcoder` / `pnpm run test:docs`; start the Web host on port 3081 under a worktree-local `DSH_HOME` for the browser smoke.
- **Development evidence**: gate output is recorded in the task note in `docs/tasks.yaml` or the commit message; `.spec/evidence` serves product tasks only.
- **Board regeneration**: after a development status change, edit `docs/tasks.yaml` first, then run `python scripts/build-tasks-html.py`.
- **Prerequisite fix**: close T-02's documentation gate (package README skeleton and bilingual pairs) before claiming the T-04 documentation gate is green.
- **AI interaction hint**: later sessions can be told "continue with the next step in active-context.md".

## 05. Rule self-evolution maintenance

This file is a dynamic board. Whenever a development task closes or business requirements change, first edit `docs/tasks.yaml` (the development ledger), then run `python scripts/build-tasks-html.py`, and finally update the current focus in this file according to §3 of [PROJECT-RULES.md](PROJECT-RULES.md); only the current window is maintained and completed history stays in git. Product data (`.spec`) changes follow the product process and do not pass through this board. Grade C small tasks are not mandatory to record; they are closed together at day end or release.
