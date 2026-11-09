# Activation context and task board (active-context.md)

English | [中文](active-context.zh.md)

## 01. Current sprint goal (Current Sprint Goal)

- **Version stage**: MVP-0 — get the workbench running locally.
- **Core business value**: the agent works inside the workbench against the `.spec` specification and task state machine, and every change has a contract, evidence, and reviewability.
- **Key deliverables**: the kernel mounts and registers model tools from the role table in `packages/lcoder/kernel/src/kernel/surface.ts`, plus the human commands, including `/contract_sign`; the right sidebar workbench has three columns; the file projection reads tasks, rules, and contracts.

## 02. Task board (Task Board)

- **Development ledger (dev-flow)**: `docs/tasks.yaml`, human-maintained, the single source of development progress.
- **Product data (LCoder)**: `.spec/` is product example data (order commission: `DR-01`/`DR-02`, `DEMO-01`), read by the kernel and the UI; its IDs do not overlap the development ledger, and changing product data does not change development progress.
- **Offline board**: `docs/tasks-html/index.html` (double-click to open; contains overview, status board, hierarchy tree, matrix, and filters).
- **Regeneration command**: `python scripts/build-tasks-html.py`.

- **Current focus**: two tracks. Cloud program: A2–A10 stay code-complete on branches with real Postgres, opencode, Docker and Caddy acceptance (A2b, A3b, A5c, A9d) parked; A9b, A11 and A9f remain registered. Desktop: T-89 roster roles, the assignment command and the strict role gate, T-90 decision-model spike, T-91 machine-readable roster signals with the local suggestion function, and T-92 task-detail suggestion card are closed on `lcoder/main` with gates green and their worktrees removed; T-93 localizes suggestion reasons and is not dispatched. T-78 closed without packaging and T-83's personal center stays synthetically verified, so installed identity, signing and the real cloud remain open; T-79, T-80, T-81 and T-82 follow, where T-80 needs the user's Mac and T-82 needs certificates.
- **Completed**: T-01 file projection; T-02 host mount; T-04 specification root and documentation gates; T-05 LCoder shell; T-06 real `.spec`/`project.yaml`/workspace-session data; T-07 project info drawer and the `.spec/project.yaml` schema; T-08 real floating conversation; T-09 README, tests, and old preset cleanup; T-56/T-57/T-58 flow engine, automation policy, and AI self-sign gates; T-59/T-60/T-61 flow UI, singleton sessions, and compaction visibility; T-66/T-67 session model switching and image/file attachments; T-73 task-detail trimming and T-74 intake result page and restart; T-89 roster assignment data plane, T-90 decision-model spike, T-91 roster signals with the local suggestion function, and T-92 task-detail suggestion card. T-03 is superseded by the shell and closed.
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
  - Signing is the human command `/contract_sign`: the Host recomputes the contract body hash and writes `sig`, and `/task_contract` re-checks the signature before a task enters `contracted`; an agent signature whose three compensating gates fail is rejected.
  - Task state has no standalone transition tool: `/task_contract` advances a signed task from `drafting` to `contracted`, `task_close` closes it, and `task_transition` does not exist.
  - `DEMO-01` is in `drafting`; `.spec/contracts/DEMO-01.contract.yaml` is tracked with `sig: null`, and the example `env.yaml` is in place.
  - `file_read` and `file_edit` resolve against the repository root; the specification root keeps `env.yaml` and evidence.
  - The desktop profile has nine role presets, each mounting `@lcoder/kernel` once with no global kernel entry, and contains no reference to `WorkBuddy/LCoder`.
  - The floating conversation renders streaming text and reasoning with bottom-follow, Markdown, approval, and question cards; tool cards are not rendered.
  - The demo repo has no `.spec/local.yaml`, so the drawer's eye shows 未配置; the local resolution path exists but has no sample file to read.
  - Task cards claim their own session through the `session` field in `.spec/tasks/<ID>.yaml`; an unbound card reads 未开始 instead of borrowing another session's state.
  - "Open repository" has a 15-second timeout with distinguishable timeout and rejection copy (T-17); the underlying documents-directory lookup hang is upstream and unfixed here (T-12, T-15, T-16).

## 04. Next immediate actions (Next Immediate Actions)

- **Currently working on**: T-97, extending the product task schema with a description, two classification axes (domain and change type) and image attachments; the detail UI follows in T-98.
- **About to execute**: accept T-97, then T-98 renders the description, tags, thumbnails and the simplified metadata, then continue the desktop release chain T-79 to T-82.
- **Open decisions**: whether product tasks should gain a `type` field so the suggestion layer can distinguish read-only tasks; the production SMS provider, the exact opencode rates behind the 20-dollar grant, the deployment domain and host, and whether to add an application-level anonymous kill switch and a `/health` endpoint.
- **Development evidence**: gate output is recorded in the task note in `docs/tasks.yaml` or the commit message; `.spec/evidence` serves product tasks only.
- **Board regeneration**: after a development status change, edit `docs/tasks.yaml` first, then run `python scripts/build-tasks-html.py`.
- **Documentation gates**: green after T-02 and T-04; package READMEs and bilingual pairs must stay green whenever documents change.
- **AI interaction hint**: later sessions can be told "continue with the next step in active-context.md".

## 05. Rule self-evolution maintenance

This file is a dynamic board. Whenever a development task closes or business requirements change, first edit `docs/tasks.yaml` (the development ledger), then run `python scripts/build-tasks-html.py`, and finally update the current focus in this file according to §3 of [PROJECT-RULES.md](PROJECT-RULES.md); only the current window is maintained and completed history stays in git. Product data (`.spec`) changes follow the product process and do not pass through this board. Grade C small tasks are not mandatory to record; they are closed together at day end or release.
