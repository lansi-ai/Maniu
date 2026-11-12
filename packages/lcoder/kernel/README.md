---
description: "LCoder's host plugin: ten specification, task, and edit tools whose visibility follows the task state, falls back to the four-tool onboarding surface when a repository has no tasks, with the specification root resolved from the session workspace."
kind: "package-reference"
---

# @lcoder/kernel

English | [中文](README.zh.md)

## Summary

`@lcoder/kernel` registers LCoder's specification and task tools with a DeepSeek Harness host. The tool surface follows the current task state: `drafting` exposes read, contract, and task-drafting tools, `contracted` adds editing, command execution, and evidence, and `closed` is read-only. A repository whose task state is unavailable gets the onboarding surface `file_read`, `spec_query`, `task_read`, `task_draft` instead of the full set. The specification root follows the session workspace, so the desktop host reads the target repository's `.spec` rather than its profile directory. Mount it through the LCoder patch layer after the host provides `tools`. `contract_sign` is deliberately absent.

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
      name: '@lcoder/kernel'
      config:
        root: !!js process.env.LCODER_SPEC_ROOT || undefined
```

| Field | Default | Meaning |
|---|---|---|
| `root` | `process.cwd()/.spec` | Fallback specification root when the session has no cwd |
| `selfCheck` | `true` | Print the tool-surface self-check at load |
| `taskId` | first task | Task whose state selects the tool surface when no session claims one; a session claimed through a task's `session` field follows that task instead, so parallel sessions each read their own state. With no task readable, the onboarding surface applies |
| `role` | unset | Role ceiling: `intake`, `architect`, `pm`, `dev`, `git`, `ops`, `review`, `scheduler`, `flow`, or `manager`. The surface intersects the state mask with that role's tools, so a role only removes capability; `scheduler` and `flow` get only `file_read`, `file_list`, `spec_query`, and `task_read`, and `role_draft` is visible only to `manager`. An unknown value fails at load |

The plugin mounts as a row through the patch layer; it has no `dsh plugin add` installation path. A tool call resolves the specification root from `session.header.cwd/.spec`; without a session cwd it uses `root`, and without `root` it uses `process.cwd()/.spec`. Alongside the tools it registers human commands that write `.spec` from the host and stay off the tool surface: `contract_sign`, `task_bind`, `task_assign`, `task_contract`, `task_split_ready`, `proposal_approve`, `deploy`, `task_schedule`, `flow_status`, `flow_log`, and `agent_bind`. `task_schedule` appends one scheduling decision to `.spec/evidence/<task>/schedule.jsonl` and, for an enqueue, writes the joint-group record under `.spec/evidence/scheduling/`. `flow_status` is a read-only evaluation returning one JSON line with the policy, the next action, and a per-task plan; `flow_log` appends one start/flow result to `.spec/evidence/<task>/flow.jsonl`; `agent_bind` writes the scheduler or flow singleton session id to `.spec/agents.yaml`. The workspace shell calls all three; none is model-visible. A callable tool would let the model sign its own contract, pick its own tool surface, or write its own audit trail. `task_assign <task id> <role id>` resolves `.spec/roles.yaml` first and then a built-in role id, writes `Task.role`, and leaves the task state untouched. `task_split_ready <task id>` advances a drafting task that a requirement split produced and that already has a role straight to `contracted`; the requirement document is its contract basis, and a task without a proposal or role is refused. `role_draft` is the model's only job-role write entry: it appends or updates one roster entry, never deletes, rejects an unknown `inherits`, and is visible only to the `manager` role; assignment stays human-only. It also accepts optional `signals` as three string arrays — `strong` technical-stack terms, `medium` weak semantic terms, and `preferredPaths` file-prefix preferences — with at most 32 entries per group and 64 characters per entry, deduplicated case-insensitively; the roster stores them for the local suggestion layer, and the scheduling gate never reads them. AI self-signing is a kernel function rather than a command or tool: `selfSignContract` writes `by: agent` only when `.spec/automation.yaml` sets `sign: auto`, the task has no `scope.irreversible`, and the contract has non-empty `review*.log` evidence, and it records the `actor` preset plus the policy path, hash, and modification time. P3 applies the same three gates, so an agent signature that fails one is invalid at closure.

`task_draft` accepts four optional task metadata fields beside the title and grade: `description` (multiline, at most 4000 characters), `category` (`page`, `api`, `data`, `other`), `change_type` (`bug`, `feature`, `improvement`, `style`), and `attachments` (at most eight image paths relative to the `.spec` root, with a `png`, `jpg`, `jpeg`, `webp`, or `gif` extension; absolute paths, `..` segments, empty strings, and other extensions are rejected). Its result echoes all four, and `task_read` returns them with the task detail.

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
| `src/tools/spec-tools.ts`, `src/tools/task-tools.ts`, `src/tools/edit-tools.ts` | The model tools |
| `src/tools/role-tools.ts` | The model-facing `role_draft` tool |
| `src/kernel/role-store.ts`, `src/schema/roles.ts` | `.spec/roles.yaml` reads and writes, plus the shared built-in role ids |
| `src/commands/task-assign.ts` | The human-only `task_assign` command writing `Task.role` |
| `src/commands/task-split-ready.ts` | The human-only `task_split_ready` command moving split tasks to `contracted` |
| `src/checkers/index.ts` | The P1, P3, and P4 closure checkers |
| `src/kernel/automation.ts` | `.spec/automation.yaml` loading, defaults, and policy hashing |
| `src/kernel/flow.ts`, `src/kernel/flow-store.ts` | Pure next-action decision and the `.spec` fact assembly |
| `src/kernel/sign-gate.ts` | The three compensating gates for AI self-signing |
| `src/commands/flow-status.ts`, `src/commands/flow-log.ts` | Flow evaluation JSON and the per-task action log |
| `src/commands/agent-bind.ts` | The two resident scheduler session ids in `.spec/agents.yaml` |

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
- `when` gates only the tools this package registers. Tools registered globally by a shipped bundle (`read`, `write`, `edit`, `glob`, `grep`, `bash`, `pwsh`) stay visible to every Agent in the profile, so an un-onboarded repository does not lose code-editing capability from this package alone; covering them takes an Agent-scope `restrict`.
- P1 uses a text index, so a symbol name in a comment or string can produce a false positive.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Build with `pnpm --filter @lcoder/kernel run bundle`; the root `tsconfig.host.json` includes this package through `references`, so `pnpm typecheck` covers it. Run the package tests with `pnpm exec vitest run packages/lcoder/kernel`.

</details>
