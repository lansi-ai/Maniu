---
description: "LCoder's host plugin: specification, task, requirement, and edit tools whose visibility follows the task state, falls back to the four-tool onboarding surface when a repository has no tasks, with the specification root resolved from the session workspace."
kind: "package-reference"
---

# @maniu/kernel

English | [中文](README.zh.md)

## Summary

`@maniu/kernel` registers LCoder's specification, task, and requirement tools with a DeepSeek Harness host. The tool surface follows the current task state: `drafting` exposes read, contract, and task-drafting tools, `contracted` adds editing, command execution, and evidence, and `closed` is read-only. A repository whose task state is unavailable gets the onboarding surface `file_read`, `spec_query`, `task_read`, `task_draft` instead of the full set. The specification root follows the session workspace, so the desktop host reads the target repository's `.spec` rather than its profile directory. Mount it through the LCoder patch layer after the host provides `tools`. `contract_sign` is deliberately absent.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in the LCoder patch layer and let a session bind the repository whose `.spec` the agent should work on.

### When to choose it

Choose it when a DeepSeek Harness composition already provides the `tools` service and the agent should work under the LCoder five-state task flow. Do not choose it as a generic file-editing toolkit: the tools are fail-closed by task state, so `file_edit` and `cmd_run` stay invisible until a contract is signed. A repository with no `.spec` at all is treated as not yet onboarded: the agent can read and draft tasks there, and closure still requires a signed contract.

### Minimal configuration

```yaml
- insert:
    - id: lcoder-kernel
      name: '@maniu/kernel'
      config:
        root: !!js process.env.LCODER_SPEC_ROOT || undefined
```

| Field | Default | Meaning |
|---|---|---|
| `root` | `process.cwd()/.spec` | Fallback specification root when the session has no cwd |
| `selfCheck` | `true` | Print the tool-surface self-check at load |
| `taskId` | first task | Task whose state selects the tool surface when no session claims one; a session claimed through a task's `session` field follows that task instead, so parallel sessions each read their own state. With no task readable, the onboarding surface applies |
| `role` | unset | Role ceiling: `intake`, `architect`, `pm`, `dev`, `git`, `ops`, `review`, `scheduler`, `flow`, or `manager`. The surface intersects the state mask with that role's tools, so a role only removes capability; `scheduler` and `flow` get only `file_read`, `file_list`, `spec_query`, and `task_read`, and `role_draft` and `requirement_split_plan` are visible only to `manager`. An unknown value fails at load |

The plugin mounts as a row through the patch layer; it has no `dsh plugin add` installation path. A tool call resolves the specification root from `session.header.cwd/.spec`; without a session cwd it uses `root`, and without `root` it uses `process.cwd()/.spec`. Alongside the tools it registers human commands that write `.spec` from the host and stay off the tool surface: `contract_sign`, `task_bind`, `task_assign`, `task_contract`, `task_split_ready`, `proposal_approve`, `proposal_reject`, `requirement_approve`, `requirement_release`, `requirement_close`, `requirement_review_decide`, `deploy`, `task_schedule`, `flow_status`, `flow_log`, `flow_save`, and `agent_bind`. `proposal_approve` applies a proposal carrying a `requirement_change` payload before the decision turns `approved`: `new` creates a requirement whose v1 snapshot note records the basis (`基于 REQ-xx vN`) or `对话新建`, and `revise` revises the draft target with the note `对话改稿，基于 vN`; a failed proposal write rolls the requirement change back. `proposal_reject` turns a draft proposal to `rejected` and never touches the requirement body. `task_schedule` appends one scheduling decision to `.spec/evidence/<task>/schedule.jsonl` and, for an enqueue, writes the joint-group record under `.spec/evidence/scheduling/`. `flow_status` is a read-only evaluation returning one JSON line with the policy, the next action, and a per-task plan; `flow_log` appends one start/flow result to `.spec/evidence/<task>/flow.jsonl`; `flow_save` writes the project flow configuration `.spec/flow.yaml` from a JSON payload, or deletes it with the `preset` argument to restore the built-in preset flow; `agent_bind` writes the scheduler or flow singleton session id to `.spec/agents.yaml`. The workbench clients call them; none is model-visible. A callable tool would let the model sign its own contract, pick its own tool surface, or write its own audit trail. `task_assign <task id> <role id>` resolves `.spec/roles.yaml` first and then a built-in role id, writes `Task.role`, and leaves the task state untouched. `task_split_ready <task id>` advances a drafting task that a requirement split produced and that already has a role straight to `contracted`; the requirement document is its contract basis, and a task without a proposal or role is refused. `role_draft` is the model's only job-role write entry: it appends or updates one roster entry, never deletes, rejects an unknown `inherits`, and is visible only to the `manager` role; assignment stays human-only. It also accepts optional `signals` as three string arrays — `strong` technical-stack terms, `medium` weak semantic terms, and `preferredPaths` file-prefix preferences — with at most 32 entries per group and 64 characters per entry, deduplicated case-insensitively; the roster stores them for the local suggestion layer, and the scheduling gate never reads them. AI self-signing is a kernel function rather than a command or tool: `selfSignContract` writes `by: agent` only when `.spec/automation.yaml` sets `sign: auto`, the task has no `scope.irreversible`, and the contract has non-empty `review*.log` evidence, and it records the `actor` preset plus the policy path, hash, and modification time. P3 applies the same three gates, so an agent signature that fails one is invalid at closure.

`task_draft` accepts five optional task metadata fields beside the title and grade: `description` (multiline, at most 4000 characters), `category` (`page`, `api`, `data`, `other`), `change_type` (`bug`, `feature`, `improvement`, `style`), `attachments` (at most eight image paths relative to the `.spec` root, with a `png`, `jpg`, `jpeg`, `webp`, or `gif` extension; absolute paths, `..` segments, empty strings, and other extensions are rejected), and `track` (one built-in `h5`, `admin`, `api`, `desktop`, `host`, or `general`, or a track appended under `tracks` in `.spec/project.yaml`; an unknown track is rejected with the available list). Its result echoes all five, and `task_read` returns them with the task detail.

`requirement_draft` writes `.spec/requirements/REQ-<number>.yaml` plus the same-named Markdown body from a required title and content, an optional `options` array (`name` and `summary` required per entry, `cost` optional), and an optional `recommendation`. It takes the next free `REQ-` number, refuses to overwrite an existing pair, writes the body first, snapshots it as v1 under `requirements/<id>/versions/v1.md`, and records `versions`; a failed metadata write removes the files it just wrote. It writes `state: draft` only.

`requirement_revise` is visible only to the `intake` role: it requires a draft requirement with a non-empty body, backfills v1 when the requirement has no version records, overwrites `REQ-<number>.md` with the new content, snapshots it as the next version under `requirements/<id>/versions/v<n>.md`, appends the version record, and returns the version number.

`requirement_propose` is visible only to the `intake` role: it writes a draft proposal `.spec/proposals/P-<number>.yaml` carrying a `requirement_change` payload and never writes the requirement body. `mode` is `new` or `revise`; `content` (the complete new Markdown body) and `analysis` (the requirement-level conclusion: conflicts or duplication with existing requirements, impact size, and a priority suggestion) are required. `revise` requires `target` and `base_version`: the target must exist and be `draft`, and the baseline version must exist — a requirement without version records accepts v1 when its body exists. `new` may carry `target` and `base_version` as a pair to record the basis; a confirmed requirement can only serve as the basis of a new requirement, never as a revision target. The proposal title derives from the body's first heading, then its first non-empty line, and the decision stays `draft` until a human runs `/proposal_approve` or `/proposal_reject`.

`requirement_review_draft` is visible only to the `pm` and `manager` roles: it requires a draft requirement with a non-empty body, writes the Markdown report to `requirements/<id>/reviews/R<round>.md`, appends a `reviews` record (round, time, report path, optional session id, and the producing session's preset id as the optional `role` signature), and returns the round. It changes neither the requirement state nor the body. Reviews recorded before signatures existed parse without `role`.

Each review carries a human disposition: `decision` is `pending` when absent or explicit, then becomes `accepted` or `rejected`, with `decided_at`, an optional `decision_note`, and `applied_version` naming the body version produced from accepted feedback. `/requirement_review_decide <id> <round> <accepted|rejected> [note]` is the human-only command that writes that decision; when accepting it also records `applied_version` if a version already exists later than the round, and rejecting clears any stale `applied_version`. Running `requirement_revise` is the other way to close a review: it marks every pending round `accepted` with `decided_at` and `applied_version` set to the version it just wrote, leaving already-terminal rounds untouched. `requirement_review_draft` refuses a further round while the latest one is still pending with no later version, and also when a round was accepted without a later version; a `rejected` round permits a fresh review. With a `.spec/flow.yaml` `review` node, the refusal is relaxed for a configured role that has not yet signed a report for the current body version: each configured role may land one round in the same version cycle, and the strict rule returns once every configured role is signed. A flow that cannot be read falls back to the strict rule, so a configuration error never permits a duplicate review. Old YAML with reviews and no decision fields still parses and is treated as pending, so a legacy round must be decided before re-reviewing. The decision command stays off the model tool surface.

`requirement_split_plan` is visible only to the `manager` role: it requires a `confirmed` requirement and a non-empty `tasks` array whose entries carry `task`, `role`, and an optional `reason`, and writes `.spec/requirements/<id>/split-plan.yaml` with the requirement id, generation time, and entries, overwriting any earlier plan. Every task must exist, point back to that requirement through `Task.requirement`, and still be `drafting`; every role must resolve through `.spec/roles.yaml` or a built-in role id, and a task may appear once. It creates no task, assigns nothing, and changes no state; assignment stays human through `/task_assign`.

`/requirement_approve` requires at least one review, every review round already disposed, and a body with a matching version snapshot; it moves a draft to `confirmed` and writes `confirmed_at`, `approved_at`, and `approved_version`. A `pending` or undecided round blocks approval and is listed by round; `accepted` and `rejected` rounds pass, and `requirement_revise` closes pending rounds automatically. When `.spec/flow.yaml` exists and configures a `review` node, the gate additionally consumes review rounds root-matched, one round per entry: an entry's root is its built-in preset's role or its roster job's `inherits`, a round's root is the built-in root of its signed preset, and each configured entry consumes one not-yet-consumed round of equal root in configuration order — `maniu-pm` plus a pm-inheriting job therefore needs two independent rounds. Unsigned legacy rounds and non-built-in preset signatures are not consumable; the refusal lists the entries with no round left. Without the file the one-round gate is unchanged. A requirement without version records gets v1; a body that differs from its latest snapshot gets a new version, so `approved_version` always names the approved body. `/requirement_release` moves a confirmed requirement to `released` only when at least one task points back through `Task.requirement` and every such task is `closed`, and otherwise reports the unclosed task ids; `/requirement_close` closes a draft or confirmed requirement and refuses a released one, which is final. `Task.requirement` is optional and coexists with `Task.proposal`; readers prefer `requirement`. The client projection composes each YAML with its Markdown body and passes `versions`, `reviews`, `approved_at`, and `approved_version` through; it reads `requirements/<id>/split-plan.yaml` when present and omits the field otherwise.

`deliverable_draft` records a task's deliverables in `.spec/deliverables/<task id>.yaml` from a required `summary`, a non-empty `docs` array of repository-relative paths, and an optional `commands` array. Every `docs` entry must resolve to an existing file under the repository root; absolute paths, `..` segments, and missing files are rejected. The tool overwrites the index per task, keeps the first `created_at`, and refreshes `updated_at`; it records the index only, and the engineering documents themselves are still written with `file_edit`. `task_close` runs D1 after P1, P3, and P4: a task graded A, assigned to the `general` track, or whose title or description mentions 基础框架, 脚手架, 架构, or 技术选型 must have a readable index with a non-empty summary and at least one document, and closure otherwise reports `.spec/deliverables/<task id>.yaml` as the next step. Ordinary tasks are unaffected. Only `dev`, `architect`, and `ops` see the tool, and only from `contracted` onward.

`.spec/flow.yaml` is the optional per-project flow configuration: `nodes` carries at most one entry per built-in node (`intake`, `review`, `revise`, `split`), each with a non-empty ordered `roles` array (built-in preset ids `maniu-<role>` or `.spec/roles.yaml` job ids) and an `auto` boolean that governs only the handoff inside the node — `true` starts the next role once the previous role's artifact lands on disk, `false` waits for a human to click next; the nodes themselves are always human-triggered. Without the file the kernel preset flow applies: intake `maniu-intake` manual, review `maniu-pm` auto, revise `maniu-intake` manual, split `maniu-manager` manual. Unknown nodes, empty roles, duplicate nodes, and unresolvable roles are rejected on both read and write, and so are entries whose built-in root lacks the node's required tools: intake needs `requirement_draft` (root `intake`), review `requirement_review_draft` (roots `pm` and `manager`), revise `requirement_revise` (root `intake`), split `requirement_split_plan` and `task_draft` (root `manager`), so a dev-inheriting job cannot enter the review node. `/flow_save <json>` is the only writer, and `/flow_save preset` deletes the file to restore the preset; the model has no flow-configuration entry.

### Talent library host presets

`@maniu/kernel/talents` mounts the host half of the talent library. The client submits cloud talents through `agentTalents/applyTalents`; each talent becomes the stable preset `talent-<cloud id>`, composed from its `basePreset` declaration with `persona` and `plugins` applied over same-named rows, including rows nested in groups. Only plugins resolvable from this host's installed packages are accepted; `url`, `source`, `package`, extra fields, `!!js` markers, duplicate names, and non-JSON values are rejected with `agent-talent/invalid` or `agent-talent/unknown-plugin`. A plugin the host profile already mounts is reused as-is when the talent adds no config; a talent config for that plugin is refused with `agent-talent/duplicate-plugin` rather than remounting the provider. Re-submitting an unchanged talent is a no-op; an edited talent replaces its definition, and running sessions keep the revision they started with. `agentTalents/removeTalent` refuses while any local session still records the preset, `agentTalents/sessionRefs` lists them, and built-in presets are never replaced or removed.

`tools`, `model`, and `budget` compose a `@maniu/kernel/talents-policy` row at the end of the preset. `tools` is a whitelist: at Agent creation the policy narrows the tool surface to the named tools, an empty list (or no list) does not restrict, and a name the mounted preset does not expose fails with `agent-talent/unknown-tool` before the talent is registered. `model` becomes the model selection of a newly started session; a resumed session keeps its recorded selection. `budget` stays cloud-side: every model request on the `lcoder-cloud` route carries `x-lcoder-session-id`, plus `x-lcoder-talent-id` when the session's preset is a registered talent, so the gateway can meter and cap that talent per session.

The same plugin exposes the read-only form catalog and project identity. `agentTalents/catalog` lists the locally resolvable plugin packages named by the root Loader and preset compositions, plus the non-talent base presets; `agentTalents/presetTools` reads one base preset's current tool surface so a whitelist can only name tools it exposes. `agentTalents/projectIdentity` reads `.spec/project.yaml` below the given project path (or a scope session's `cwd`) without writing it. New projects get their `projectId` from `project_draft` when the file is first registered; for an existing file that lacks the field, the client calls `agentTalents/ensureProjectId` automatically once and the write is idempotent. A missing `.spec/project.yaml` is never given an invented id.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin named-exports `name`, `inject`, and `apply`, matching the upstream function-plugin form. It injects `tools` and registers each definition with a `when` condition that is evaluated once per model step. The condition reads the task state from disk on every step, so signing a contract or advancing a task changes the visible tools immediately.

Every tool factory accepts either a fixed root or a resolver. The resolver reads the narrow session fact `agent.session.header.cwd`; the plugin supplies one resolver to all tool factories, so a single session sees one specification root across spec and task operations. The file tools receive the repository root (the specification root's parent), while `cmd_run`, `env.yaml`, and evidence stay under the specification root.

| File | Responsibility |
|---|---|
| `src/plugin.ts` | Tool registration, surface gating, and the load-time self-check |
| `src/kernel/spec-root.ts` | Session-first specification root resolution |
| `src/kernel/spec-store.ts` | Rule and state-machine reads and writes |
| `src/kernel/task-store.ts` | Task objects, transitions, and persistence |
| `src/kernel/requirement-store.ts` | Requirement objects, numbering, version snapshots, review records and decisions, split-plan suggestions, and the multi-file write |
| `src/tools/spec-tools.ts`, `src/tools/task-tools.ts`, `src/tools/edit-tools.ts` | The model tools |
| `src/tools/requirement-tools.ts` | The model-facing `requirement_draft`, `requirement_revise`, `requirement_propose`, `requirement_review_draft`, and `requirement_split_plan` tools |
| `src/tools/deliverable-tools.ts` | The model-facing `deliverable_draft` tool |
| `src/kernel/deliverable-store.ts`, `src/schema/deliverable.ts` | Delivery index reads and writes, plus the must-deliver rule |
| `src/commands/requirement-approve.ts`, `src/commands/requirement-release.ts`, `src/commands/requirement-close.ts`, `src/commands/requirement-review-decide.ts` | The four human-only requirement commands: state transitions and review disposition |
| `src/commands/proposal-approve.ts`, `src/commands/proposal-reject.ts` | The human-only proposal decision commands; approve applies a `requirement_change` payload into the requirement body |
| `src/schema/requirement-progress.ts` | The pure nine-state requirement progress derivation |
| `src/tools/role-tools.ts` | The model-facing `role_draft` tool |
| `src/kernel/role-store.ts`, `src/schema/roles.ts` | `.spec/roles.yaml` reads and writes, plus the shared built-in role ids |
| `src/commands/task-assign.ts` | The human-only `task_assign` command writing `Task.role` |
| `src/commands/task-split-ready.ts` | The human-only `task_split_ready` command moving split tasks to `contracted` |
| `src/checkers/index.ts` | The P1, P3, P4, and D1 closure checkers |
| `src/kernel/automation.ts` | `.spec/automation.yaml` loading, defaults, and policy hashing |
| `src/kernel/flow.ts`, `src/kernel/flow-store.ts` | Pure next-action decision and the `.spec` fact assembly |
| `src/kernel/flow-config.ts` | `.spec/flow.yaml` reads, writes, preset fallback, node capability checks, and root-matched review-signature consumption |
| `src/commands/flow-save.ts` | The human-only `flow_save` command writing or resetting the flow configuration |
| `src/kernel/sign-gate.ts` | The three compensating gates for AI self-signing |
| `src/commands/flow-status.ts`, `src/commands/flow-log.ts` | Flow evaluation JSON and the per-task action log |
| `src/commands/agent-bind.ts` | The two resident scheduler session ids in `.spec/agents.yaml` |
| `src/talents/service.ts`, `src/talents/validate.ts`, `src/talents/compose.ts`, `src/talents/policy.ts` | Dynamic talent presets: registration, wire validation, composition, and the per-Agent policy row |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- `packages/lcoder/workspace` — the browser-side projection of the same `.spec` files.
- `lcoder/cordis.patch.yml` — the patch layer that mounts both LCoder packages.
- `lcoder/RUN.md` — startup and verification.
- `lcoder/UPSTREAM-BASELINE.md` — the upstream relationship and contact surface.

-----

## Model Experience

### Registered tools

#### What the model sees

The tool names, descriptions, and `parameters` JSON Schemas, filtered by the current task state through `when` and then narrowed by the configured role ceiling; a repository without a readable task state sees the onboarding surface. Human commands are never present.

#### Token effect

Every visible tool description and parameter schema occupies request tokens on each step; hiding a tool through `when` removes its declaration from that step.

#### KV Cache effect

The visible tool set changes only on a task-state transition. Re-applying the same state is a no-op, and a transition invalidates the request prefix from the first changed tool schema token. The role ceiling is fixed when the plugin mounts, so it never moves mid-session.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- `contract_sign` is absent by design; signing runs outside the model turn. AI self-signing exists only as the `selfSignContract` seam under the three gates, and no executor calls it yet; the flow panel marks an allowed self-sign instead of performing it.
- `flow_status` re-reads the whole `.spec` on each call and is not subscribed to file changes; the shell asks again when the projection reloads or a batch finishes.
- `.spec/automation.yaml` is read whenever the kernel evaluates a decision; it has no writer, so a human edits it directly. The policy cannot carry external irreversible actions such as push or deployment.
- `task_transition` has no tool entry; advancing a task requires editing its YAML.
- Talent tool whitelists and default models apply when an Agent is created with the talent preset. Rebinding a live session to another preset through `agent-presets` does not reapply them, and tools registered directly in an Agent's own scope stay visible because restrictions exempt the viewing scope's registrations.
- `when` gates only the tools this package registers. Tools registered globally by a shipped bundle (`read`, `write`, `edit`, `glob`, `grep`, `bash`, `pwsh`) stay visible to every Agent in the profile, so an un-onboarded repository does not lose code-editing capability from this package alone; covering them takes an Agent-scope `restrict`.
- P1 uses a text index, so a symbol name in a comment or string can produce a false positive.
- Dynamic talent presets are process-local: the client must submit them again after every host restart, and a session that recorded a talent cannot resume until it does.
- Removal protection covers this machine only, as decided: sessions on another device do not block a cloud-side deletion.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Build with `pnpm --filter @maniu/kernel run bundle`; the root `tsconfig.host.json` includes this package through `references`, so `pnpm typecheck` covers it. Run the package tests with `pnpm exec vitest run packages/lcoder/kernel`.

</details>
