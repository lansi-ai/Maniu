---
description: "The LCoder workbench tab: a read-only three-column projection of .spec tasks and rules over the upstream workspaceFiles remote, with no model-facing contribution."
kind: "package-reference"
---

# @lcoder/workspace

English | [中文](README.zh.md)

## Summary

`@lcoder/workspace` adds the LCoder workbench tab to the right sidebar. The tab reads `.spec` task and rule YAML through the upstream `workspaceFiles` remote and draws three columns: tasks, specification and code bindings, and the conversation. It is read-only: state-machine decisions stay in the kernel, and the browser never writes product data. Mount it through the LCoder patch layer when you already run the kernel; it has no configuration surface and no separate Remote. Without a bound workspace the columns stay as a skeleton.

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

Mount the package in the LCoder patch layer and open the workbench tab in a session bound to a repository that contains `.spec`.

### When to choose it

Choose it when the kernel already runs in the same composition and the user needs to read tasks and rules without asking the model. Do not choose it for editing specification data or for state transitions: the package is a projection, and the kernel owns both writes and state-machine decisions.

### Minimal configuration

```yaml
- insert:
    - id: ui-lcoder-workspace
      name: '@lcoder/workspace'
```

| Field | Default | Meaning |
|---|---|---|
| (none) | — | The package has no configuration surface |

The package mounts as a plugin row through the patch layer; it has no `dsh plugin add` installation path.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package registers three client contributions: a sidebar tab type, a locale namespace, and a pane body. The body receives a projection function through the slot `inject` factory, so the package depends on the slot runtime, the locale service, the tab registry, and the remote face, and it stays inactive when any of them is missing.

The data path is `src/client/projection.ts`: it calls `files.list` and `files.readPage` on the `workspaceFiles` namespace, parses the YAML, and returns rows plus per-file problems. The host resolves relative paths against the session workspace (`session.header.cwd`), and the kernel resolves its specification root from the same session header, so the tools and the UI read one `.spec`.

| File | Responsibility |
|---|---|
| `src/client/definition.ts` | Tab kind, id, priority, and guide entry |
| `src/client/index.ts` | Service injection, locale registration, and pane slot registration |
| `src/client/projection.ts` | Read `.spec` YAML through `workspaceFiles` and build display rows |
| `src/client/WorkspaceBody.tsx` | Render the three columns and the empty or error states |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- `packages/lcoder/kernel` — the host plugin that writes the YAML this package reads.
- `packages/client/ui-sidebar-files` — the closest upstream tab implementation with a store and component.
- `packages/client/ui-agent-preset` — a settings-page shape close to the workbench.
- `lcoder/RUN.md` — startup, mounting, and the verification steps.

-----

## Model Experience

### Workbench UI

#### What the model sees

Nothing. The workbench reads `.spec` YAML through `workspaceFiles` and renders it in the browser; it registers no tool, prompt section, or model schema.

#### Token effect

None; this package never builds a model request.

#### KV Cache effect

None; no request prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The kernel's `file_read` / `file_edit` still treat the specification root as their boundary; real-repository acceptance will decide whether they should use the repository root.
- The workbench reads once when the tab opens; incremental refresh through `workspaceFiles.changes` is deferred.
- The shared selection across the three columns is deferred to T-03.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Build with `pnpm --filter @lcoder/workspace run bundle`; the root `tsconfig.client.json` includes this package through `references`, so `pnpm typecheck` covers it. Run the package tests with `pnpm exec vitest run packages/lcoder/workspace`.

</details>
