# LCoder product and design document (PRD)

English | [中文](prd-and-design.zh.md)

## 0. Document scope

This document collects LCoder's business consensus and design. It is the source of the decisions recorded in [PROJECT-RULES.md](PROJECT-RULES.md). Product runtime task and specification data is not written here; the single source of LCoder product data is the `.spec/` directory in the working repository. This document is the MVP-0 baseline; later capabilities are recorded in [tasks.yaml](tasks.yaml) and [desktop-release.md](desktop-release.md), which govern current scope.

This repository carries two kinds of task assets that must not be mixed: `.spec/tasks` is **LCoder product data**, read by the kernel and the UI; `docs/tasks.yaml` is the **development ledger for building LCoder itself** (dev-flow), maintained by people. Neither derives from the other; the repository-root `.spec` has been replaced with an order-commission example (`DR-01`/`DR-02`, `DEMO-01`) whose IDs do not overlap the development ledger.

## 1. Background and problem

A common failure in agent coding is not an inability to write code, but not knowing what counts as done: requirements scatter across conversation, acceptance rests on the model's own claim, and change boundaries leave no record. LCoder turns "specification → contract → implementation → verification → closure" into an executable state machine and stores the specification library as YAML in the repository, so the agent and the human read the same facts and close work under the same criteria. The substrate is DeepSeek Harness: it provides a plugin host, tool registration, sessions, and UI extension points, which suit second development better than rewriting a runtime.

## 2. Product positioning

One-sentence positioning: LCoder is a specification-driven development workbench for Windows and macOS desktop, packaging the `.spec` specification library, task state machine, and agent tool-surface control as a DeepSeek Harness plugin layer. The target users are individuals and small teams using agents for real-repository development who need auditable, reproducible change evidence. The value proposition is that the model can work only within the tool surface it is meant to see, and every closure leaves a contract, evidence, and specification bindings.

## 3. Relationship with upstream

LCoder is a second development of DeepSeek Harness: it does not fork business implementations and does not import upstream internal paths. The current baseline is `0.2.2-alpha.2` (2026-10-30). Branch model: `master` is a read-only upstream mirror; `lcoder/main` is the main line; upstream sync uses a temporary `sync/upstream-<version>` branch and merges back only when everything is green. Mounting principles live in [UPSTREAM-BASELINE.md](../lcoder/UPSTREAM-BASELINE.md): prefer adding over modifying; upstream changes touch only the assembly layer; every contact point is registered and reviewed by a human.

## 4. Core concepts

| Concept | Location | Description |
|---|---|---|
| Specification entry `RuleEntry` | `.spec/spec/rules.yaml` | Stable id, source, status, code bindings, and acceptance references |
| State machine `StateMachine` | `.spec/spec/states/*.yaml` | State set, legal transitions, and guards |
| Task `Task` | `.spec/tasks/T-xx.yaml` | Five states, grade, allowed paths, irreversible items, required evidence |
| Contract `Contract` | `.spec/contracts/T-xx.contract.yaml` | change / not_change / acceptance / fail_if plus the human signature |
| Evidence `Evidence` | `.spec/evidence/T-xx/*.log` | Only a non-empty file counts as evidence |
| Environment `Env` | `.spec/env.yaml` | Repository, acceptance commands, credential sources |
| Resident sessions `AgentsRegistry` | `.spec/agents.yaml` | The scheduling and flow-control singleton session ids; a stale id is re-resolved from the workspace's matching agent preset |
| Job roles `RolesFile` | `.spec/roles.yaml` | Project-defined positions: id, display name, the built-in role they inherit, and an optional persona prefix |

The single source of shapes is [packages/lcoder/kernel/src/schema/spec.ts](../packages/lcoder/kernel/src/schema/spec.ts): the schema guarantees shape only; semantic compliance belongs to the checkers.

## 5. Core flow (five states)

The following five states are the task flow inside the LCoder product; development tasks for building LCoder itself use the A/B/C grades in [PROJECT-RULES.md](PROJECT-RULES.md) §3. Do not mix the two processes.

| State | Entry condition | Model-visible capability | Exit |
|---|---|---|---|
| `drafting` | Task created, contract unsigned | Read code, query specifications, bind locations, draft the contract and further tasks | A valid signature (human, or AI under the three gates), then `contracted` |
| `contracted` | Contract signed validly | Adds editing, command execution, evidence attachment | Enter `implementing` |
| `implementing` | Implementing against the contract | Same as above | Only `verifying`, or back to `contracted` to re-sign |
| `verifying` | Evidence complete | Adds `task_close` | `closed` after P1/P3/P4; otherwise back to `implementing` |
| `closed` | Terminal | Read-only | None |

The state machine only judges graph legality; whether a task may enter `contracted` also depends on a signed contract, decided by P3 and kept out of the state machine. Closure is `task_close` chaining three checkers: P1 gives every entry a binding, P3 requires a signature that still covers the current contract body and is either human-written or an AI self-signature whose three compensating gates hold, and P4 requires evidence for every entry; if any fails, the state does not change. AI self-signing is a user decision from 2026-11-06: it requires `sign: auto` in the automation policy, an empty `scope.irreversible`, and non-empty review evidence for that contract, and a task with any irreversible item is always signed by a human.

A repository with no task on disk is not a sixth state. Until the first `task_draft` lands there, the kernel applies the onboarding surface described in §6.

## 6. Tool surface

The model tools and the per-role ceilings live in one place, `packages/lcoder/kernel/src/kernel/surface.ts` (`SURFACE`, `UNSCOPEED_SURFACE`, and `ROLE_TOOLS`); this document does not restate their names or count. The tool surface follows the task state, using an allow list (fail-closed): an unconfigured tool is invisible by default, so a missed configuration means "cannot use" rather than "can use beyond authority". A repository whose task state is unreadable — no `.spec`, or an empty `tasks/` — gets `UNSCOPEED_SURFACE`, so investigation, project information, draft specification entries, and task drafting work there while editing and command execution do not. The surface has a second dimension: a role is an Agent preset selected when the session is created and locked after its first turn, and the visible tools are `SURFACE[state]` intersected with the role's ceiling, so a role can only remove capability. `dev` deliberately carries no ceiling — its table must equal the full registered set, and a test pins that equality so a newly added tool cannot go silently invisible to the implementing role. Five commands never enter a model tool surface, in any state table or role table: `contract_sign`, `task_bind`, `task_contract`, `task_assign`, and `proposal_approve`. They are human-command entries only; `contract_sign` in particular is never a model tool, because a model that can call a signing tool can sign for itself. `/contract_sign <task id>` runs outside the model's turn, the Host recomputes the contract body hash and writes `sig`, and both the call and its outcome are recorded in the session log. Registration uses `when`, evaluated once per model step, instead of `restrict`; `restrict` only applies to globally registered tools and cannot cover scoped registrations. `when` therefore reaches only this package's registrations: tools registered globally by a shipped bundle (`read`, `write`, `edit`, `glob`, `grep`, `bash`, `pwsh`) stay visible to every Agent in the profile, and covering them takes an Agent-scope `restrict` (§11).

## 7. Data plane

The workbench reads YAML under `.spec` directly and projects files through the upstream `workspaceFiles` remote namespace; it does not build its own Remote and does not use the typert generator. The projection is injected per session; without a bound workspace the three columns stay as a skeleton. State-machine decisions stay out of the UI and remain in the kernel. Paths must match the kernel's writes: `task-store.taskPath` and `spec-store.saveRules` both use `.spec` as root; a fork produces no type error, only wrong data on screen.

The kernel's specification root follows the session workspace: a tool call uses `session.header.cwd/.spec`. Without a session cwd (headless launches, startup self-check) it falls back to the configured `root`, then to `process.cwd()/.spec`. The desktop host runs with the profile directory as its process cwd, not the target repository, so the session workspace is the only source that keeps the tools and the UI projection on the same `.spec`.

A task can additionally record which session works on it: `session` in `.spec/tasks/<ID>.yaml`. A human writes it through the `/task_bind` command when opening a conversation for that task, and the model never writes it — the session id comes from the host's own invocation, so a browser cannot claim a session that is not its own. The value is a runtime identifier inside this machine's home: after a machine change or a deleted session the kernel falls back to the configured task id and then to the first task on the board, and the task's own state never changes because of a stale claim. Releasing a claim deletes the key rather than leaving it empty, because an empty value makes the whole board unreadable.

`.spec/automation.yaml` carries one automation policy per project: a switch per action (`draft`, `contract`, `sign`, `implement`, `verify`, `close`, `commit`), stop conditions (token budget, minutes, consecutive failures, parallel limit), and an optional task list. A missing file means every action is manual, matching the behavior without automation. External irreversible actions — push, deployment, registry and environment changes — cannot appear in the file; the schema rejects such keys rather than ignoring them. The kernel re-reads the file on every evaluation, so an edit applies to the next decision.

A job role is a lightweight position the project defines in `.spec/roles.yaml`: an id, a display name, a built-in role it inherits, and an optional persona prefix. Inheritance is the whole ceiling, so a new position cannot exceed the built-in role it names; the engineering manager (`manager`) is the tenth built-in role, and `role_draft` is its only write entry — it appends or updates one position and never deletes, and an unknown `inherits` is rejected. Assignment is a separate, human-only step: `/task_assign <task id> <role id>` resolves the roster first and then a built-in role id, writes `Task.role`, and leaves the task state untouched; the model never receives an assignment entry. Read-side resolution never fails: a `role` that neither the roster nor the built-in list knows is displayed as an unknown position, matching the stale-session-id rule. The assigned role is a scheduling constraint with strict job matching and a development fallback. Both sides normalize to a pair of (job id, inherited built-in role): two job roles must be equal; a job role accepts a session only when that session's effective role is the built-in `dev` it inherits; a task whose role is itself a built-in role is compared as a built-in role. A session's effective role comes from the role on the task it claims, then from the position a human chose when creating the session, then from its preset (`lcoder` is `dev`, and `lcoder-<built-in>` maps to that built-in). Claimed roles that disagree contribute no role, and when either side has no resolvable role the gate stays inactive so existing sessions are not rejected.

The two resident scheduler sessions are recorded in `.spec/agents.yaml`. A missing session, a deleted one, or an id whose `agentPreset` no longer matches is treated as unbound: the shell first looks for a workspace session running `lcoder-scheduler` or `lcoder-flow`, and only then creates one and writes its id back through `/agent_bind`. The flow panel reads `/flow_status` and appends each start result through `/flow_log`; neither command advances task state, and signing plus external actions stay separate from the batch.

The flow engine decides the next action instead of handing out work: a pure function over task facts, the policy, and consumed budget, returning one of `draft`, `contract`, `sign`, `implement`, `verify`, `close`, `commit`, `external`, or `stop`, with a reason and the blockers (signature, dependency, budget, external). It neither reads nor writes; `flow-store` assembles the facts from `.spec`, and the executor that drives the existing human commands and internal APIs belongs to the flow-control entry. Self-signing is one such action: `selfSignContract` writes `by: agent` only when all three gates hold, and records the `actor` preset together with the authorizing policy path, hash, and time.

## 8. MVP scope (MVP-0)

This phase delivers: the host mounts the kernel, and the registered tools follow the task state; a "Workbench" tab appears in the right sidebar; the three columns connect to the file projection; a human signs a contract in the workbench and the Host writes the signature; one local command starts everything.

Explicitly out of scope: the workbench advancing task state (state stays hand-written in `.spec/tasks/*.yaml`); an independent `task_transition` tool; incremental refresh; multiple workspaces and a permission model; remote sync; full bilingual rework of upstream documents.

## 9. Acceptance criteria

- After startup the log shows the resolved specification root and the registration line naming the registered tools and human commands, with no activation failures.
- The browser plugin manifest contains `@lcoder/workspace/client.js`, and the right sidebar shows the "Workbench" tab.
- After the session binds a workspace directory, the three columns read the tasks and rules under `.spec`.
- `pnpm typecheck`, `pnpm lint`, and `pnpm exec vitest run packages/lcoder` are green; `pnpm run test:docs` is green when documents change.

## 10. Key decisions

| Number | Decision | Reason |
|---|---|---|
| D1 | The data plane uses file projection, not a typert Remote | Reads the single source of truth; the UI does not own state-machine logic |
| D2 | Mounting uses an independent patch layer | No upstream manifest changes; the smallest upgrade conflict surface |
| D3 | The tool surface is fail-closed | A missed configuration removes capability instead of expanding authority |
| D4 | Signing is not a model-invoked tool | A model that can call signing at will makes S1 false; signing stays on the human-command surface or the flow executor |
| D5 | Product data and the development ledger are separate | `.spec/tasks` is product data; `docs/tasks.yaml` is the development ledger; the board is generated only from the ledger |
| D6 | Single-track governance | One responsibility line and one next step; `active-context.md` is a single file |
| D7 | Tool surface is state × role, never role alone | State is progress and role is a ceiling, so a misconfigured role removes capability instead of granting it |
| D8 | Task ownership is claimed in `.spec`, not inferred from titles | `.spec` is the only product fact source; a session title is human-editable and cannot be a foreign key |
| D9 | Parallel work is one workspace with N sessions | One session per task at depth 1; grandchildren are refused, so cost stays bounded while roles can delegate to review |
| D10 | AI may self-sign only under three compensating gates | User decision 2026-11-06; the gates keep P3 meaningful after opening the human-only premise: policy `sign: auto`, empty `scope.irreversible`, and review evidence |
| D11 | Job roles are lightweight definitions that inherit a built-in ceiling; assignment is a human command and a scheduling hard constraint | A manager can name positions without inventing new permissions; letting the model assign would let it choose which session may reuse the task |

## 11. Risks and technical debt

- Signing is wired: the human command `/contract_sign` lets the Host write the signature, and the workbench shows each task's contract body with a sign action. The browser never writes `.spec`; P3 invalidates a signature whose hash no longer covers the body. A signature is valid when human-written, or when an AI self-signature passes all three gates; the contract records the `actor` preset and the policy path, hash, and time, and the projection exposes agent signatures separately. A human advances `drafting → contracted` through `/task_contract` once the signature checks out; later transitions are still hand-written YAML.
- The flow engine, the policy loader, and AI self-signing are implemented with unit and real-file coverage. The 开工 entry, the flow panel, and the per-task action log run through the human commands `/flow_status` and `/flow_log`; `selfSignContract` still has no caller outside tests, so an allowed AI self-sign is marked in the panel rather than performed. Repositories without `.spec/automation.yaml` keep the all-manual behavior.
- A prompt with no usable model used to fail silently: admission accepts the message, the turn then fails on the Host, and the event stream never carries a `user/message`. `client/model-status.ts` folds `session/modelCatalog` into ready, empty, or unknown; an empty catalog blocks the send and names where the credential belongs, and the session snapshot's `promptError` and `lastAgentError` surface in the floating panel. The isolated in-repo home carries no provider credential, so a fresh checkout needs `DEEPSEEK_API_KEY` before any conversation can run.
- `implementing → verifying` has no tool entry; advancing the state requires editing the task file by hand.
- The role gate is strict by position with a development fallback. A session's effective role comes from the task it claims, then from the position a human chose when creating the session, then from its preset (`lcoder` maps to `dev`, `lcoder-<built-in>` to that built-in); claimed roles that disagree contribute nothing rather than guessing one. A task assigned to a roster job is reused only by the same job, or by a session whose effective role is the built-in `dev` it inherits; other built-ins are rejected with both role names in the reason. When either side has no resolvable role the gate stays inactive, so sessions created before assignment keep working. A position chosen for a session is remembered in the window that created it; after a restart the claimed task or the preset supplies the role, and a session with neither leaves the gate inactive.
- The onboarding surface removes this package's editing and command tools only. Bundle-registered tools stay available to every Agent in the profile, so an un-onboarded repository does not lose code-editing capability from LCoder alone; an Agent-scope `restrict` covering them is tracked as T-11.
- The product example `DEMO-01` is in `drafting` with no contract yet; the example `env.yaml` is in place.
- Development tasks do not use `.spec` contracts or evidence; see [PROJECT-RULES.md](PROJECT-RULES.md) §3 for the development gates.
- Upstream upgrades must check the three tsconfig/lock contact surfaces and the root `AGENTS.md` entry; conflicts require human review.
- On Windows, `dev:web` child processes outlive the shell; clean the process tree before switching instances.
- The repository-root `.spec` is the order-commission example (`DR-01`/`DR-02`, `DEMO-01`), not a development task list; development progress is judged by `docs/tasks.yaml`.
- Windows and macOS installers are unsigned until T-82 and are internal test artifacts only. Unsigned macOS automatic updates are unverified; identity, update source, signing limits, and the macOS adaptation matrix live in [desktop-release.md](desktop-release.md).

## 12. Running entry points

Startup, mounting, the four verification steps, and pitfall records live in [RUN.md](../lcoder/RUN.md). Development progress and next steps live in [active-context.md](active-context.md); the development board is at [docs/tasks-html/index.html](tasks-html/index.html). Desktop release identity, update source, signing gap, and the macOS adaptation matrix live in [desktop-release.md](desktop-release.md).
