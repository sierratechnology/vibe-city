# Prioritized roadmap

## 0 — Finish evaluating First Signal (current slice)
- Two humans play together on separate LAN machines. Evaluate camera feel, crafting clarity, construction reach and shelter readability.
- Test Safari, Firefox and lower-powered hardware. Measure sustained frame times, network latency, reconnect and server sleep/wake.
- Tune materials, camera obstruction, nameplates, sound and resource feedback based on playtesting.
- Preserve the small reproducible loop as a regression target.

## 1 — A dependable shared settlement
- Password recovery, character deletion, administrative controls, and an explicit migration path for legacy anonymous pilots. Accounts, three-character selection, reconnect and daily world backups are implemented.
- Input sequence acknowledgment and reconciliation, delta snapshots, latency/loss tests, build ownership permissions and collaborative dismantling.
- Richer modular snapping: passable doorway frames, directional angled canopies, nearby-operated sealed doors, and low-rise Deck stairs are implemented. A Deck stair rotates among four supported free deck edges and provides a traversable terrain-to-current-deck transition only. The bounded sealed door blocks and seals its edge while closed, becomes traversable and unsealed while open, and persists its server-owned state. These pieces do not add locks, automatic doors, pressure equalization, airlock cycles, room pressurization, structural support, multi-level building, ladders, elevators, arbitrary vertical building, or generalized enclosure simulation; those broader systems remain planned.
- One buildable Workbench and its bounded Field meal queue are implemented: one active job, two pending jobs, five seconds of server-running game time, exact-once delivery, blocked-output preservation, and no offline catch-up. A nearby owner can grant or revoke queue use for individual saved collaborators; every accepted job reserves that actor's ingredients and returns output only to that actor, without granting ownership or dismantle/cargo authority. Each actor can cancel only their own pending Field meal for an exact refund; active and blocked-output jobs remain uncancellable. Shared cargo lockers, item transfers, PIN protection, and owner-managed full-transfer grants for individual saved collaborators are implemented. Broader recipes, queue reordering, owner moderation, bulk controls, storage or workbench roles, groups, organizations, offline invitations and automation remain planned.
- Accessible remapping and touch/controller controls are implemented. Short generated Interface and World/Gameplay cues now have independent browser-local volume settings and a master mute; audio is gesture-gated and supplementary, with no speech, music, account sync or server/world-save fields. Physical phone speaker/headphone and physical-controller audio remain unverified.

## 2 — A planet worth exploring
- Seeded regions and streaming; biomes, hazards and distinctive ruins with discoverable patterns.
- Tools and equipment progression, sustainable gathering/farming and optional threats.
- Improve the original art language and add optimized authored assets.
- Expand the finite construction palette before deciding whether true voxels/terrain editing are essential.

## 3 — Production and inhabited places
- Power, production chains and resource logistics.
- Settler jobs; buildable robots and drones with understandable tasks and costs.
- Deterministic, bounded background production and explicit offline catch-up. No unbounded per-frame simulation while nobody is present.

## 4 — From ground to orbit
- Construct and test spacecraft, then travel to moons and other planets within the server's solar system.
- Colonies and space stations, with server-owned inventories and travel transitions.
- Define world sizes, server budgets and simulation fidelity from measurements.

## 5 — Connected worlds
- Expand moderation, recovery, hosting capacity and abuse defenses beyond the current authenticated public playtest.
- Decide whether interstellar travel connects servers, creates instances or remains within larger server domains.
- Reassess engine/native packaging and cross-platform requirements using evidence from actual players.

This sequence is a dependency order, not a calendar or a claim that future features are already built.
