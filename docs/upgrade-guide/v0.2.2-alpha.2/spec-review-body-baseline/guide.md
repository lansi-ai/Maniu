---
kind: upgrade-guide
description: "LCoder `.spec` gains an in-place `patch` requirement-change proposal and an optional review body baseline; older proposals and reviews stay readable."
---

# LCoder draft modification and review body baseline

English | [中文](guide.zh.md)

## Change

LCoder adds an in-place draft modification flow. A `.spec/proposals/P-xx.yaml` may now carry `requirement_change.mode: patch` with `target` and `base_content`, the body the host read when it generated the proposal. Approving it with `/proposal_approve` rewrites only the current draft body: it adds no version, writes no snapshot, changes no requirement state, and disposes no review decision.

Each review in `.spec/requirements/REQ-xx.yaml` may now carry an optional `base_content`, the body read when that report was written. Review staleness and accepted-review version association use this baseline, so a report still refers to the body it examined after an in-place patch. Records without the field keep the earlier version-timestamp behavior.

This affects scripts and templates that write these YAML files by hand, and readers that assume every change creates a version or that a review decision has no body baseline.

## Migration

1. No rewrite is required for existing `.spec` files. Old proposals, requirements, and reviews parse unchanged; leave `base_content` absent on old reviews.
2. For a modification proposal, write `mode: patch` with `target`, `base_content` (the body actually read), `content`, and `analysis`. Do not supply `base_version` for this mode.
3. When writing a review record, include `base_content` with the body read at that moment, and keep treating the field as optional on read.
4. Confirm by opening an existing requirement with old reviews, then generating and applying a patch proposal: the report keeps its original body as the baseline, the body changes in place, and the version list stays unchanged.
