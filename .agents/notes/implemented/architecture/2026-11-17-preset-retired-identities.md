# Agent Note: Retired preset identities belong to the declaring preset

Status: implemented

English | [中文](2026-11-17-preset-retired-identities.zh.md)

## Problem

A Session header records the Agent preset it started under, and released Session logs are never rewritten. Resuming such a Session asks the preset registry for that recorded identity, so any product rename of a preset id turns every earlier Session into `agent-preset/not-found` even though its events, role, and workspace are intact. LCoder's T-226 rename from `lcoder*` to `maniu*` had to keep those Sessions resumable without keeping the old ids in the roster and without registering the whole role composition twice.

## Decision

A preset declaration may list `retiredIds`. The registry indexes those identities when the declaration is registered and unregisters them with it. Every identity read — `resolve`, `retain` (and therefore `mount` and `select`), `readDocument`, `definitionPlugins`, and `definitionScope` — follows one alias hop from a retired id to the declaring preset. Registration fails loud when a retired id collides with a live preset id, with another declaration's retired id, or with the declaration's own id.

## Alternatives considered

- Registering hidden alias presets keeps resolution local to YAML, but every alias eagerly mounts a second copy of the role composition and adds a roster row that the upstream settings surface cannot hide.
- Mapping ids inside the session controller or the client only covers resume and display; cloud-stored talent configurations also reference `basePreset`, and they resolve through `definitionPlugins`.

## Consequences

The recorded projection keeps the retired id, so the roster, session list, and history display it verbatim; product surfaces that compare preset ids must accept both generations, which the LCoder client does by normalizing the prefix for role inference, talent names, session counts, and scheduling. Resolution is one hop by design: a retired id never chains through another retired id. A Session resumed under a retired identity runs the current declaration, so later selections and new Sessions record the current id.
