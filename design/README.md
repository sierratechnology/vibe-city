# Vibe City Design Studio

The Vibe City Design Studio is the isolated asset-production lane for Vibe City. It creates reviewable visual source, deterministic exports, previews, manifests, and integration notes without mixing experimental design work into the active runtime tree.

## Team

### Marlowe Vale — Visual Systems Designer

- Hermes profile: `marlowevale`
- Alias: `marlowevale`
- Worktree: `/Users/devon/STG-worktrees/vibe-city-design-studio`
- Branch: `marlowe/vibe-city-design-studio`
- Default write boundary: `design/`
- Reviewer: Spiders
- Project coordination: Ariadne

Marlowe has web/reference research, local browser preview, terminal, file, code-execution, vision, skills, todo, and clarification capabilities. Messaging, gateway ownership, delegation, cron, memory, computer control, TTS, video generation, and paid image generation are disabled. The profile has no project credentials.

## Asset workflow

1. Assign one bounded packet with a truthful world purpose and explicit non-scope.
2. Read the design bible, roadmap, and relevant runtime asset contract.
3. Create the packet under `design/assets/<packet-id>/`.
4. Export and validate it:

   ```bash
   cd design/tools
   npm ci
   npm run export -- ../assets/<packet-id>
   npm run validate -- ../assets/<packet-id>
   ```

5. Inspect every preview independently.
6. Run the repository production build from the worktree root.
7. Record limitations and classify the packet honestly.
8. Integrate through a separate runtime assignment and exact-tree review.

## Generation boundary

The current M1 MacBook Air has 8 GB unified memory, below the local ComfyUI skill's supported Apple Silicon threshold. No local ComfyUI or large diffusion models were installed, and no cloud generation plan or credits were activated. The studio starts with deterministic SVG and procedural design work. Paid or cloud generation remains a separate provider, cost, and credential decision.

## Current verified packet

- `design/assets/world-zero-wayfinding-v0/`
- Six original SVG sources
- Six optimized SVG exports
- Six deterministic PNG previews
- Status: `verified` source asset packet; not integrated or released
