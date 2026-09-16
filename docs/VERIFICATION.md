# Verification record

## Automated evidence

- **Eight game-rule tests:** seeded generation, complete progression, authoritative validation, atomic shared depletion, normalized movement/collision, ion-wind damage and shelter recovery, dismantling/refunds, atomic persistence and invalid-save refusal.
- **Two simultaneous real Chrome clients**, in separate browser contexts, connected to a real local WebSocket server using a temporary save.
- Browser actions use keyboard movement, held E gathering, fabrication UI, ruin interaction, construction previews and mouse clicks. No server inventory grants, teleports or fabricated network messages are used in this end-to-end test.
- Both clients render two avatars. The second observes the first moving, depleting a deposit and placing all four construction types.
- A real server restart preserves the seed, depleted deposits, buildings, inventory, cutter, technology unlock and milestone completion. The browser reconnects using its saved pilot identity.
- No browser JavaScript errors in the recorded run. See `browser-test-report.json` for the latest timestamp and sampled rendering statistics.
- Browser screenshots in `screenshots/` show the actual rendered test world. That world is isolated and removed afterward; it is not a prefabricated player world.

## Visual review

The title screen and completed-outpost gameplay view were inspected as images. The terrain, resource silhouettes, astronaut, ruin, construction, objective steps, inventory, suit meters and multiplayer count are visible. Meshes are intentional low-poly placeholders. Camera obstruction avoidance and remote player nameplates are implemented; subjective comfort still benefits from human playtesting.

## Practical limits

- Two clients were tested on one Mac, not two separate physical computers. Joining over LAN is implemented, but firewall/Wi-Fi behavior requires a second-machine check.
- The sampled 60 FPS / approximately 24k rendered triangles is an automated Chrome observation, not a sustained MacBook Air thermal or battery benchmark. Two visible clients are the tested load; the eight-connection cap is not a performance guarantee.
- Chrome is tested. Safari, Firefox, touch controls, controllers, packet loss and high-latency internet play are not verified.
- This is a finite terrain region, four-piece construction set and one discovery—not planets, spaceflight, NPCs, automation or offline simulation.
- The server uses full snapshots at 10 Hz. Movement prediction is basic; production-quality latency reconciliation and scalable interest management remain future work.
- Local saves are persistent but not cloud backed up. Browser-local pilot identities are not portable user accounts.
- Optional Game Development Studio CLI was unavailable; no claims are made about its capture receipts or hardware profiling.

## Reproduce

Run `npm test`, then `npm run test:browser`. The browser test requires Chrome; `CHROME_PATH` can override its executable location. All test saves use temporary directories. The normal game save is untouched.

## September 16: ten-player, pointer and cloud update
- Ten actual WebSocket clients admitted, eleventh rejected, departed slot reusable.
- Phone emulation: real touchscreen events move, hold-gather, operate fabrication/construction, and combine camera drag with joystick. Touch cancellation stops movement. Portrait/landscape screenshots saved. Physical phone remains untested.
- Mouse-only movement pad verified; keyboard shortcuts remain optional.
- Two independent server instances connected to the actual Upstash resource using a disposable world key. Shared movement and persisted coordinates verified; test key removed afterward.
- Shared-cloud transaction tests verify ten-seat concurrency, cooldown persistence, reconnect progression, expired sessions and rejection of stale sessions.

## Live domain verification
- https://vibe-city.net deployed on September 16, 2026. Public HTTPS health check confirms maxPlayers=10 and Redis persistence.
- Two real Chrome browser clients joined the deployed WebSocket endpoint. Mouse-only movement on one client was observed by the other, phone-sized client. Reload restored the explorer identity and saved position. No browser page errors.
- See live-verification.json and screenshots/live-*.png. Physical-phone testing and a sustained ten-rendered-client load test remain outstanding. The ten-player admission test uses real network sockets, not ten rendered browsers.
- Original source backed up in vibe-city-previous-project.zip outside the repository; full previous history retained in Git.
