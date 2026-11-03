# LCoder product and design document (PRD)

English | [中文](prd-and-design.zh.md)

## 0. Document scope

This document collects LCoder's business consensus and design. It is the source of the decisions recorded in [PROJECT-RULES.md](PROJECT-RULES.md). Product runtime task and specification data is not written here; the single source of LCoder product data is the `.spec/` directory in the working repository.

This repository carries two kinds of task assets that must not be mixed: `.spec/tasks` is **LCoder product data**, read by the kernel and the UI; `docs/tasks.yaml` is the **development ledger for building LCoder itself** (dev-flow), maintained by people. Neither derives from the other; the repository-root `.spec` has been replaced with an order-commission example (`DR-01`/`DR-02`, `DEMO-01`) whose IDs do not overlap the development ledger.

## 1. Background and problem

A common failure in agent coding is not an inability to write code, but not knowing what counts as done: requirements scatter across conversation, acceptance rests on the model's own claim, and change boundaries leave no record. LCoder turns "specification → contract → implementation → verification → closure" into an executable state machine and stores the specification library as YAML in the repository, so the agent and the human read the same facts and close work under the same criteria. The substrate is DeepSeek Harness: it provides a plugin host, tool registration, sessions, and UI extension points, which suit second development better than rewriting a runtime.

## 2. Product positioning

One-sentence positioning: LCoder is a specification-driven development workbench for Windows desktop, packaging the `.spec` specification library, task state machine, and agent tool-surface control as a DeepSeek Harness plugin layer. The target users are individuals and small teams using agents for real-repository development who need auditable, reproducible change evidence. The value proposition is that the model can work only within the tool surface it is meant to see, and every closure leaves a contract, evidence, and specification bindings.

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

The single source of shapes is [packages/lcoder/kernel/src/schema/spec.ts](../packages/lcoder/kernel/src/schema/spec.ts): the schema guarantees shape only; semantic compliance belongs to the checkers.

## 5. Core flow (five states)

The following five states are the task flow inside the LCoder product; development tasks for building LCoder itself use the A/B/C grades in [PROJECT-RULES.md](PROJECT-RULES.md) §3. Do not mix the two processes.

| State | Entry condition | Model-visible capability | Exit |
|---|---|---|---|
| `drafting` | Task created, contract unsigned | Read code, query specifications, bind locations, draft the contract | A human signs the contract, then `contracted` |
| `contracted` | Contract signed by a human | Adds editing, command execution, evidence attachment | Enter `implementing` |
| `implementing` | Implementing against the contract | Same as above | Only `verifying`, or back to `contracted` to re-sign |
| `verifying` | Evidence complete | Adds `task_close` | `closed` after P1/P3/P4; otherwise back to `implementing` |
| `closed` | Terminal | Read-only | None |

The state machine only judges graph legality; whether a task may enter `contracted` also depends on a signed contract, decided by P3 and kept out of the state machine. Closure is `task_close` chaining three checkers: P1 gives every entry a binding, P3 requires a human signature for irreversible items, and P4 requires evidence for every entry; if any fails, the state does not change.

## 6. Tool surface

The kernel registers nine tools with the host: `file_read`, `file_edit`, `cmd_run`, `evidence_attach`, `spec_query`, `spec_bind`, `contract_draft`, `task_read`, and `task_close`. The tool surface follows the task state, using an allow list (fail-closed): an unconfigured tool is invisible by default, so a missed configuration means "cannot use" rather than "can use beyond authority". `contract_sign` is never registered as a model tool: a model that can call a signing tool can sign for itself. Registration uses `when`, evaluated once per model step, instead of `restrict`; `restrict` only applies to globally registered tools and cannot cover scoped registrations.

## 7. Data plane

The workbench reads YAML under `.spec` directly and projects files through the upstream `workspaceFiles` remote namespace; it does not build its own Remote and does not use the typert generator. The projection is injected per session; without a bound workspace the three columns stay as a skeleton. State-machine decisions stay out of the UI and remain in the kernel. Paths must match the kernel's writes: `task-store.taskPath` and `spec-store.saveRules` both use `.spec` as root; a fork produces no type error, only wrong data on screen.

The kernel's specification root follows the session workspace: a tool call uses `session.header.cwd/.spec`. Without a session cwd (headless launches, startup self-check) it falls back to the configured `root`, then to `process.cwd()/.spec`. The desktop host runs with the profile directory as its process cwd, not the target repository, so the session workspace is the only source that keeps the tools and the UI projection on the same `.spec`.

## 8. MVP scope (MVP-0)

This phase delivers: the host mounts the kernel, nine tools register and follow the task state; a "Workbench" tab appears in the right sidebar; the three columns connect to the file projection; one local command starts everything.

Explicitly out of scope: a contract-signing UI or human command; an independent `task_transition` tool; incremental refresh; multiple workspaces and a permission model; remote sync; full bilingual rework of upstream documents.

## 9. Acceptance criteria

- After startup the log shows the nine tool-registration lines and the `http://127.0.0.1:3080` address, with no activation failures.
- The browser plugin manifest contains `@lcoder/workspace/client.js`, and the right sidebar shows the "Workbench" tab.
- After the session binds a workspace directory, the three columns read the tasks and rules under `.spec`.
- `pnpm typecheck`, `pnpm lint`, and `pnpm exec vitest run packages/lcoder` are green; `pnpm run test:docs` is green when documents change.

## 10. Key decisions

| Number | Decision | Reason |
|---|---|---|
| D1 | The data plane uses file projection, not a typert Remote | Reads the single source of truth; the UI does not own state-machine logic |
| D2 | Mounting uses an independent patch layer | No upstream manifest changes; the smallest upgrade conflict surface |
| D3 | The tool surface is fail-closed | A missed configuration removes capability instead of expanding authority |
| D4 | Signing is not a model tool | The model cannot sign for itself, which is what makes S1 hold |
| D5 | Product data and the development ledger are separate | `.spec/tasks` is product data; `docs/tasks.yaml` is the development ledger; the board is generated only from the ledger |
| D6 | Single-track governance | One responsibility line and one next step; `active-context.md` is a single file |

## 11. Risks and technical debt

- The contract-signing channel is missing: P3 requires a human signature, but there is no signing UI or human command yet, so a YAML file must be edited by hand.
- `implementing → verifying` has no tool entry; advancing the state requires editing the task file by hand.
- The product example `DEMO-01` is in `drafting` with no contract yet; the example `env.yaml` is in place.
- Development tasks do not use `.spec` contracts or evidence; see [PROJECT-RULES.md](PROJECT-RULES.md) §3 for the development gates.
- Upstream upgrades must check the three tsconfig/lock contact surfaces and the root `AGENTS.md` entry; conflicts require human review.
- On Windows, `dev:web` child processes outlive the shell; clean the process tree before switching instances.
- The repository-root `.spec` is the order-commission example (`DR-01`/`DR-02`, `DEMO-01`), not a development task list; development progress is judged by `docs/tasks.yaml`.

## 12. Running entry points

Startup, mounting, the four verification steps, and pitfall records live in [RUN.md](../lcoder/RUN.md). Development progress and next steps live in [active-context.md](active-context.md); the development board is at [docs/tasks-html/index.html](tasks-html/index.html).
