# Survival loop research and implementation brief

Original Vibe City gameplay and UI implementation; no borrowed art, audio, branding or source code.

## Sources reviewed
- Minecraft's official [beginner hub](https://www.minecraft.net/en-us/minecraft-tips-for-beginners) and [How to Minecraft](https://www.minecraft.net/en-us/article/how-minecraft): visible resources, inventory/crafting, simple first shelter, food.
- Minecraft's official [Build the Basics video](https://www.youtube.com/watch?v=KdndAhvBCiI): sampled playback shows first-person placement and overhead construction sequences. Apply clear placement feedback and reusable pieces, not its block art.
- [Valheim official feature overview](https://www.valheimgame.com/) and [Early Access Launch Trailer](https://www.youtube.com/watch?v=5mHRJ1KFe20): sampled playback and official description emphasize gathering, settlement building, shelter and cooperation.
- Rust's official [Tutorial Island design post](https://rust.facepunch.com/news/lighting-the-way): teach a repeatable sequence of resources, crafting, base building, respawning and storage; no tutorial reward advantage needed.
- [Rust official trailer](https://www.youtube.com/watch?v=LGcECozNXEw), opened from the official homepage: survival/cooperation reference footage. Trailer review is not hands-on playtesting.

## Chosen release scope
1. Backpack grid with useful item actions and belt assignment; preserve stable focus.
2. Searchable/categorized crafting and construction catalog, ingredient counts and a pinned material list.
3. Authoritative bulk locker transfers (matching, store all, take all), plus quick stack transfer.
4. Claim own bunk as home with safe server-selected respawn and landing fallback.
5. Optional first-expedition checklist in the guide, never center-screen popups.
6. Distinct original synthesized action/footstep/landing sounds and bounded world feedback.
7. Active fifty-player simulation and persistence/concurrency checks; separate measured local evidence from unverified production hardware/network claims.

## Constraints
Preserve live saved worlds and identity/permission rules. No world reset, destructive terrain migration, copied game assets, new paid asset service, or additional center HUD buttons. Private inventory and home data stay private. A feature must pass server-authority, save/reconnect and input-flow checks before release.

## Validation evidence
- Regression suite: 335 passing tests, plus an additional outbound-snapshot isolation test.
- Real local browser: gather, drop, belt assignment, virtual-controller grid focus, recipe search/filter/pin/craft, deck placement, bulk/Shift transfers, home claim, checklist and 390 px phone layout. Existing repeated controller-storage and admin vehicle test also passed.
- Fifty authenticated simulated WebSocket clients: 5,000 movement inputs, 612 accepted actions, 50 crafted cutters and decks, repeated gathering, contested shared-locker capacity/conservation, and saved inventory/structure reload. Local run: 35.03 seconds, action p95 361.94 ms, event-loop p95 183.24 ms. This run overlapped regression/render work; it is a bounded local-load result, not a hosting SLA.
- Five concurrent workers used the cloud compare-and-set transaction path with 50 leased explorers: 500 resource units preserved and 200-unit locker limit respected. Store was in memory, not production Redis.
- One Chrome/Metal browser rendered 50 moving server fixtures at 1440×900 on Apple M1. Initial sample 29 FPS; subsequent samples 44–54 FPS. A visual review found excessive nameplate overlap and prompted a bounded, collision-avoiding label pass. Final projected-label run: samples ranged from 38–60 FPS, 687 draw calls and six visible names (hard limit eight). Blender was running; this is not an isolated hardware benchmark.
- Under-load testing exposed local fixed-timestep clock drift. Elapsed-time substeps now preserve timing, with a one-second catch-up limit; repeated server baseline validation was reduced while inbound client validation and snapshot/privacy checks remain.
- Production 50-human internet/Redis load, physical controller/phone behavior and sustained long-session performance remain unverified.

- Final two-browser real-input regression passed gathering, cutter crafting, ruin unlock, four shared pieces, sheltered/powered completion and actual server restart preserving inventory, depletion and construction. Workbench queue/output/reconnect browser regression also passed.
