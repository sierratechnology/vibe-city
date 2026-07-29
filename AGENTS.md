# Vibe City Design Studio

## Source of Truth

Runtime code and tests in this worktree are authoritative for what the current application actually does.

The current design-bible documents are pinned to commit `84a7f1cd3f8514869d6c0d5e1744a203aac267f3` on `origin/spiders/vibe-city-design-bible-v0`. They are intentionally not copied into this branch. Read them without changing branches:

```bash
git show 84a7f1cd3f8514869d6c0d5e1744a203aac267f3:VIBE_CITY_ROADMAP.md
git show 84a7f1cd3f8514869d6c0d5e1744a203aac267f3:VIBE_CITY_MASTER_DESIGN.md
git show 84a7f1cd3f8514869d6c0d5e1744a203aac267f3:VIBE_CITY_GAMEPLAY.md
git show 84a7f1cd3f8514869d6c0d5e1744a203aac267f3:VIBE_CITY_LORE.md
git show 84a7f1cd3f8514869d6c0d5e1744a203aac267f3:STG_TOWER_OPERATIONS.md
```

If that commit is unavailable, report the design lane as blocked; do not substitute an arbitrary checkout or newer unreviewed document. Relevant runtime and asset-registry code under `src/` remains required reading for integration-facing work.

The roadmap's status vocabulary and representational-integrity rules are binding. Vibe City is the visual interface to real hosted systems, not decorative simulation.

## Workspace Boundary

This branch and worktree are the isolated design lane owned by Marlowe Vale:

- Worktree: `/Users/devon/STG-worktrees/vibe-city-design-studio`
- Branch: `marlowe/vibe-city-design-studio`
- Default writable area: `design/`
- Runtime integration under `src/` requires a separate explicit assignment and review.
- Marlowe must not deploy, push, merge, or start gateways from this lane.
- Spiders may review, commit, and push a verified design handoff branch; merging or deploying it remains a separate integration decision.
- Do not add paid services, credentials, telemetry, or unreviewed third-party workflow code.

## Asset Packet Contract

Each packet lives under `design/assets/<packet-id>/` and contains:

- `BRIEF.md` — purpose, world meaning, non-scope, target dimensions, visual tokens, accessibility, performance, and integration notes.
- `manifest.json` — machine-readable identity, versions, source/export paths, dimensions, provenance, license, status, and validation commands.
- `source/` — editable originals.
- `exports/` — runtime-oriented outputs.
- `previews/` — human-review artifacts.
- `VALIDATION.md` — commands, outcomes, limitations, and integration state.

Use lowercase kebab-case IDs and filenames. SVGs must have a `viewBox`, explicit accessible title/description when they communicate meaning, no scripts, no external references, and no embedded secrets or metadata. Raster previews should be generated deterministically from source.

## Visual Direction

- Calm, premium, lightly retro-futurist office world.
- Dark slate and graphite foundations, warm ivory orientation text, cyan for information, emerald for working/available, amber for restricted or not-configured, and rose only for real high-severity conditions.
- Strong silhouettes and restrained geometry that remain legible on mobile and Pi-class presentation.
- Environmental signs and props should feel like part of the building, not floating dashboard widgets.
- Never rely on color alone. Pair state colors with text, symbols, shape, or texture.

## Verification

Before handoff:

1. Validate JSON and XML/SVG syntax.
2. Scan SVG for scripts, event handlers, external URLs, and unsupported embedded content.
3. Generate PNG previews through the checked-in local design toolchain.
4. Inspect preview dimensions and file sizes.
5. Run `npm run build` from the repository root to prove design-only additions do not break production.
6. Report exact paths and classify the work honestly: `produced`, `verified`, `integration-ready`, `integrated`, or `released`.
