---
description: "The LCoder shell: project switch, five-state task board, project-info drawer, and a real floating conversation over the session workspace's .spec."
kind: "package-reference"
---

# @lcoder/workspace

English | [中文](README.zh.md)

## Summary

`@lcoder/workspace` is LCoder's shell: project switch, a five-state task board and project-info drawer from the workspace's `.spec`, a floating conversation, empty-board and intake-result entries, a restart action that resends the same prompt in a new session, and a Start work panel. Two entries open the resident scheduling and flow-control sessions; the conversation shows context occupancy and compaction, switches models from a chip, and sends images or files. Mount it through the LCoder patch layer; `shell: false` keeps the older right-sidebar tab. The shell is read-only over product data: decisions and writes stay in the kernel.

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

Starting a conversation from a task card reuses the session that task already claims through `.spec/tasks/<ID>.yaml`'s `session` field. When none is live, the shell opens another session in the same repository, names the chosen role while creating it — the preset locks after the first turn — and claims the task for that session through the `/task_bind` human command, which the kernel writes. Roles come from `agentPresets.list`, limited to preset ids starting with `lcoder` — an upstream preset mounts none of this package's tools, so it could not read `.spec` at all; a refused or empty roster leaves the Host default role in play. The header's session bar lists this workspace's sessions, labels each with the task claiming it, and switches the active one. Each task card and its detail show the assigned job role from `.spec/tasks` (`Unassigned` when the field is absent); `.spec/roles.yaml` supplies display names, and an id neither the roster nor the built-in list knows shows as an unknown job role. The detail panel assigns through the `/task_assign` human command; an empty roster says where to draft positions instead. The detail shows the task description with its line breaks, the area and change-type tags, and read-only image thumbnails read through `workspaceFiles.readBytes`; a missing or unreadable file shows its name in place instead of failing the panel. Metadata keeps only difficulty and job role, while rules, required evidence, and tool surface sit under More with a plain-language hint each.

The floating conversation subscribes to the session event window and renders user/assistant text; the input sends another prompt to the same session. Its header chip shows the session's model from the `modelSelection` projection, or the catalog default marked as a default, and opens provider groups that call `session.selectModel`; the same call also saves the global default. The composer accepts images as base64 `image` parts and other files through `fileUploads.upload` receipts, checks images against the projected `imageLimits`, and assembles text, images, then files into one prompt. A refused send keeps the draft and attachments; a model without image input is reported instead of dropping them. With no task on disk, the board offers two actions. New project opens a requirements-analyst wizard: a three-section briefing (analyst profile, seven-question workflow, optional model choice) stays collapsed until confirmed; after confirmation the seven-question intake prompt goes out, and the question cards, the collapsed thinking row, and the proposal result with Confirm requirements and More rounds stay in the same panel. A round that ends without a readable proposal stops the thinking spinner, explains that state, and offers Start over in place. Existing material sends the analysis prompt that reads the repository and its declared documents first in the floating conversation. Either intake prompt is sent once: the decision reads the session's own record — a started turn, existing messages, or a prompt awaiting its first turn — so closing the wizard, reloading, or reopening the window only recomputes the stage from those facts and never resends. Confirm requirements calls `/proposal_approve` for the latest proposal, closes the panel, and refreshes the projection; a failed approval keeps the panel open with the Host's text. The board header opens an intake result page: it shows the highest-numbered proposal (other proposals switch in place), every drafted task with those pointing back to the current proposal marked, and the project registration, repository, branch, and document paths; with no proposal it offers the same two intake actions, and unreadable projection files are listed verbatim. An intake session's floating header adds Start over: a confirmation lists the registered project, spec entries, tasks, and proposals, then creates a session through the Host default role and resends the same tier's intake prompt. Nothing already written is deleted, and the old session stays selectable from the header.

Start work and the flow panel draw the kernel's `/flow_status` result: the policy source and switches, the overall next action with its blockers, and a per-task plan. A task is startable only when the decision has no blocker and its action is one the shell can hand to a conversation (`contract`, `implement`, `verify`, `close`, `commit`); signing and external actions are listed separately for a person. A batch runs the selected tasks in the plan's order, keeps going when one fails, and writes each result through `/flow_log`; a task already running or queued in its session is only focused, so repeated clicks do not send the prompt twice. The action history merges `.spec/evidence/<task>/flow.jsonl` with `schedule.jsonl`, newest first.

The scheduling and flow-control entries resolve their singleton session from `.spec/agents.yaml` (`schedulerSession`, `flowSession`); a missing session or a mismatched `agentPreset` falls back to the first workspace session running that preset, and only then to a new session whose id is written back through `/agent_bind`. Opening always corrects the title to the role name. Both presets mount `compaction-basic` explicitly, so a model switch changes the threshold through the adapter's `contextWindow`. The package itself registers no model tool, prompt section, or schema.

| File | Responsibility |
|---|---|
| `src/client/index.ts` | Shell registration, file/prompt callbacks, and the `shell: false` tab |
| `src/client/shell/Shell.tsx` | Project switch, task board, project-info drawer, task detail, and floating conversation |
| `src/client/shell/ChatExtras.tsx` | Model chip and provider panel, attachment strip, and the attach button |
| `src/client/shell/TaskAttachments.tsx` | Read-only task image thumbnails and the zoom dialog |
| `src/client/shell/chat-composer.ts` | Pure model-panel state, current-model resolution, attachment checks, and prompt assembly |
| `src/client/shell/shell-data.ts` | Shell types, the per-task startup prompt, the onboarding prompt, and session message extraction |
| `src/client/shell/intake.ts` | Intake-session tier detection, restart action, and result-page counts |
| `src/client/shell/intake-wizard.ts` | Wizard stage from session facts, flattened process items, and model options |
| `src/client/shell/IntakeWizard.tsx` | Requirements-analyst wizard: briefing, question layer, thinking row, and result card |
| `src/client/shell/IntakeResultPage.tsx` | Intake result page and the restart confirmation dialog |
| `src/client/onboarding.ts` | Send/open/block decision for the onboarding action, from session facts |
| `src/client/flow-status.ts` | Shape validation for the `/flow_status` JSON |
| `src/client/flow-history.ts` | Merged `flow.jsonl` / `schedule.jsonl` action history |
| `src/client/singleton.ts` | Resident-session resolution for the two scheduler roles |
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
- The session bar labels a session by the task claiming it, not by its role; the single-entry resolution reads `agentPreset` from the session projection, but lists still show the claiming task's title.
- The floating conversation renders final user/assistant text from the session event window, not the full DSH conversation UI (tool cards, live token streaming). Compaction markers and context occupancy are drawn, but the compacted summary itself remains an ordinary context row.
- `flow_status` is evaluated once per projection reload and after a batch; the panel does not subscribe to `.spec` file changes.
- The task board reads the first session in the selected workspace; a task-specific session per task is deferred.
- The shell reloads when the selected workspace or session changes; incremental refresh through `workspaceFiles.changes` is deferred.
- The project-info drawer resolves `passwordRef` from `.spec/local.yaml`; environment-variable resolution is deferred.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Build with `pnpm --filter @lcoder/workspace run bundle`; the root `tsconfig.client.json` includes this package through `references`, so `pnpm typecheck` covers it. Run the package tests with `pnpm exec vitest run packages/lcoder/workspace`. Keep the `shell: false` fallback working when the tab path changes.

</details>
