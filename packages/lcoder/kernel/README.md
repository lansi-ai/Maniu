---
description: "LCoder's host plugin: ten specification, task, and edit tools whose visibility follows the task state, falls back to the four-tool onboarding surface when a repository has no tasks, with the specification root resolved from the session workspace."
kind: "package-reference"
---

# @lcoder/kernel

English | [中文](README.zh.md)

## Summary

`@lcoder/kernel` registers LCoder's ten specification and task tools with a DeepSeek Harness host. The tool surface follows the current task state: `drafting` exposes read, contract, and task-drafting tools, `contracted` adds editing, command execution, and evidence, and `closed` is read-only. A repository whose task state is unavailable gets the onboarding surface `file_read`, `spec_query`, `task_read`, `task_draft` instead of the full set. The specification root follows the session workspace, so the desktop host reads the target repository's `.spec` rather than its profile directory. Mount it through the LCoder patch layer after the host provides `tools`. `contract_sign` is deliberately absent.

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
| `taskId` | first task | Task whose state selects the tool surface; with no task readable, the onboarding surface applies |
| `role` | unset | Role ceiling: `intake`, `architect`, `dev`, or `review`. The surface intersects the state mask with that role's tools, so a role only removes capability; an unknown value fails at load |

The plugin mounts as a row through the patch layer; it has no `dsh plugin add` installation path. A tool call resolves the specification root from `session.header.cwd/.spec`; without a session cwd it uses `root`, and without `root` it uses `process.cwd()/.spec`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin named-exports `name`, `inject`, and `apply`, matching the upstream function-plugin form. It injects `tools` and registers each definition with a `when` condition that is evaluated once per model step. The condition reads the task state from disk on every step, so signing a contract or advancing a task changes the visible tools immediately.

Every tool factory accepts either a fixed root or a resolver. The resolver reads the narrow session fact `agent.session.header.cwd`; the plugin supplies one resolver to all ten tools, so a single session sees one specification root across spec and task operations. The file tools receive the repository root (the specification root's parent), while `cmd_run`, `env.yaml`, and evidence stay under the specification root.

| File | Responsibility |
|---|---|
| `src/plugin.ts` | Tool registration, surface gating, and the load-time self-check |
| `src/kernel/spec-root.ts` | Session-first specification root resolution |
| `src/kernel/spec-store.ts` | Rule and state-machine reads and writes |
| `src/kernel/task-store.ts` | Task objects, transitions, and persistence |
| `src/tools/spec-tools.ts`, `src/tools/task-tools.ts`, `src/tools/edit-tools.ts` | The ten model tools |
| `src/checkers/index.ts` | The P1, P3, and P4 closure checkers |

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

The ten tool names, descriptions, and `parameters` JSON Schemas, filtered by the current task state through `when`; a repository without a readable task state sees the onboarding surface. `contract_sign` is never present.

#### Token effect

Every visible tool description and parameter schema occupies request tokens on each step; hiding a tool through `when` removes its declaration from that step.

#### KV Cache effect

The visible tool set changes only on a task-state transition. Re-applying the same state is a no-op, and a transition invalidates the request prefix from the first changed tool schema token.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- `contract_sign` is absent by design; a human signs contracts outside the model turn.
- `task_transition` has no tool entry; advancing a task requires editing its YAML.
- `when` gates only the tools this package registers. Tools registered globally by a shipped bundle (`read`, `write`, `edit`, `glob`, `grep`, `bash`, `pwsh`) stay visible to every Agent in the profile, so an un-onboarded repository does not lose code-editing capability from this package alone; covering them takes an Agent-scope `restrict`.
- P1 uses a text index, so a symbol name in a comment or string can produce a false positive.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Build with `pnpm --filter @lcoder/kernel run bundle`; the root `tsconfig.host.json` includes this package through `references`, so `pnpm typecheck` covers it. Run the package tests with `pnpm exec vitest run packages/lcoder/kernel`.

</details>
