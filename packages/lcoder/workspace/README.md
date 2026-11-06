---
description: "The LCoder shell: project switch, five-state task board, project-info drawer, and a real floating conversation over the session workspace's .spec."
kind: "package-reference"
---

# @lcoder/workspace

English | [中文](README.zh.md)

## Summary

`@lcoder/workspace` is LCoder's shell. It shows the selected project, a five-state task board from the session workspace's `.spec`, a project-info drawer from `.spec/project.yaml`, and a floating conversation that sends the startup prompt through the real session. The project picker can open another repository, creating or reusing its workspace and a session. An empty board offers an onboarding prompt from the delivery documents declared there. Mount it through the LCoder patch layer when the kernel already runs; `shell: false` keeps the older right-sidebar tab. The shell is read-only over product data: state-machine decisions and writes stay in the kernel.

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

Mount the package in the LCoder patch layer. When `shell` is true (the default) it registers the `lcoder-home` main panel and selects it; the project picker lists the Host workspaces, and Open repository registers a directory and creates a session.

### When to choose it

Choose it when the kernel already runs and the user should work from LCoder's project/task shell. Do not choose it for editing specification data or for state transitions: the shell projects product data, and the kernel owns writes and state-machine decisions. Set `shell: false` when only the older right-sidebar workbench tab is wanted.

### Minimal configuration

```yaml
- insert:
    - id: ui-lcoder-workspace
      name: '@lcoder/workspace'
```

| Field | Default | Meaning |
|---|---|---|
| `shell` | `true` | Render the LCoder shell in the `lcoder-home` main panel; `false` keeps the right-sidebar tab |
| `openTimeoutMs` | `15000` | Per-step deadline for Open repository; a deadline hit reports a timeout, a refusal reports the reason |

The package mounts as a plugin row through the patch layer; it has no `dsh plugin add` installation path.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package registers the shell main panel and, with `shell: false`, the older tab. The shell reads the workspace and session lists through the framework hooks, uses `workspaceFiles` for `.spec/tasks`, `.spec/spec/rules.yaml`, `.spec/project.yaml`, and `.spec/local.yaml`, and sends prompts through the session controller. The project picker's Open repository calls `workspaces.create` and `sessions.create`, then selects the new workspace. Each step waits at most `openTimeoutMs`: a deadline raises `WorkspaceOpenTimeoutError` naming the stalled step, and the shell shows the timeout text with that step; a refusal keeps the returned reason. The two cases use separate dictionary keys so a hung call is never labeled "failed".

Starting a conversation from a task card reuses the session that task already claims through `.spec/tasks/<ID>.yaml`'s `session` field. When none is live, the shell opens another session in the same repository, names the chosen role while creating it — the preset locks after the first turn — and claims the task for that session through the `/task_bind` human command, which the kernel writes. Roles come from `agentPresets.list`, limited to preset ids starting with `lcoder` — an upstream preset mounts none of this package's tools, so it could not read `.spec` at all; a refused or empty roster leaves the Host default role in play. The header's session bar lists this workspace's sessions, labels each with the task claiming it, and switches the active one.

The floating conversation subscribes to the session event window and renders user/assistant text; the input sends another prompt to the same session. With no task on disk, the board offers two actions on one session: New project sends the seven-question intake prompt, and Existing material sends the analysis prompt that reads the repository and its declared documents first. Whichever is clicked first sends once; every later click on either only reopens the floating conversation. The decision reads the session's own record — a started turn, existing messages, or a prompt awaiting its first turn — so a reload or a reopened window does not send it again. The package itself registers no model tool, prompt section, or schema.

| File | Responsibility |
|---|---|
| `src/client/index.ts` | Shell registration, file/prompt callbacks, and the `shell: false` tab |
| `src/client/shell/Shell.tsx` | Project switch, task board, project-info drawer, task detail, and floating conversation |
| `src/client/shell/shell-data.ts` | Shell types, the per-task startup prompt, the onboarding prompt, and session message extraction |
| `src/client/onboarding.ts` | Send/open/block decision for the onboarding action, from session facts |
| `src/client/shell/Shell.module.css` | Shell layout and overlay styles |
| `src/client/projection.ts` | `.spec` tasks/rules, `project.yaml`, and `local.yaml` reads |
| `src/client/definition.ts` | Tab kind, id, priority, and guide entry for the fallback mode |
| `src/client/WorkspaceBody.tsx` | Three-column body for the fallback tab |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- `packages/lcoder/kernel` — the host plugin; its file tools use the repository root.
- `lcoder/RUN.md` — startup, the desktop profile, and the smoke steps.
- `packages/client/ui-workspace` — the upstream workspace model behind the project picker.
- `packages/lcoder/kernel/fixtures/demo` — the demo repository with a `.spec`.

-----

## Model Experience

### Shell UI

#### What the model sees

The shell registers no tool, prompt section, or schema. A user prompt sent from the floating conversation, including the onboarding prompt, reaches the model as ordinary session input; task and project data are read through `workspaceFiles` and are not injected into requests.

#### Token effect

None from this package; user prompts and replies are ordinary session content.

#### KV Cache effect

None; the package does not change request prefixes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- A timed-out Open repository releases only the shell: the underlying `workspaces.create` stays pending because the upstream Workspace command queue has no cancellation.
- The session bar labels a session by the task claiming it, not by its role: the framework's session rows carry no `agentPreset`, and the shell does not infer one from the transcript.
- The floating conversation renders final user/assistant text from the session event window, not the full DSH conversation UI (tool cards, live token streaming).
- The task board reads the first session in the selected workspace; a task-specific session per task is deferred.
- The shell reloads when the selected workspace or session changes; incremental refresh through `workspaceFiles.changes` is deferred.
- The project-info drawer resolves `passwordRef` from `.spec/local.yaml`; environment-variable resolution is deferred.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Build with `pnpm --filter @lcoder/workspace run bundle`; the root `tsconfig.client.json` includes this package through `references`, so `pnpm typecheck` covers it. Run the package tests with `pnpm exec vitest run packages/lcoder/workspace`. Keep the `shell: false` fallback working when the tab path changes.

</details>
