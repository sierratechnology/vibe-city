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

## Living Basin update

- 21 rule/network tests pass, including server-directory restrictions, day/night activation, neutral and hostile AI, walls blocking attacks, meat/meal use, flashlight drain, legacy-save upgrade and idempotent daily snapshots.
- Full two-client keyboard/UI gameplay loop and actual disk-server restart passed after the camera, creature and construction changes.
- Mouse/touch controls passed after the server-browser and expanded-action layout changes.
- Additional isolated browser fixture verifies crafted flashlight use/battery drain, food use, barrier and lamp construction, and medium-creature visibility changing at daybreak. These fixtures never modify the live world.
- Physical phone playtesting, sustained ten-player combat load, and observing the next naturally scheduled midnight backup remain manual/future checks. Triggering a backup endpoint manually does not prove the scheduled midnight run has occurred.

## Accounts and cargo update — September 16
- 24 rule/integration tests passed, including concurrent three-character creation, password verification, foreign-character rejection in the ownership service, logout, disk persistence, ten authenticated WebSocket clients, backpack limits, shared locker conservation and capacity/range restrictions.
- Two real local browsers completed gathering, crafting, ruin unlock, shared construction and server restart persistence with zero page errors. Sample: 60 FPS, 59 draw calls, 24,108 triangles. This is a sample, not a hardware guarantee.
- Isolated fixture browser tests verified account registration, three selectable characters, cargo construction, two-client deposits/withdrawals and reload persistence. Fixture materials were used only in temporary test worlds.
- Night fixture test verified flashlight crafting/drain, food, barriers, wall lighting and day/night creature visibility.
- Touch emulation passed movement, gathering, multitouch cancellation, controls and storage layout. A physical phone and Safari still require manual testing.
- Two independent server processes authenticated distinct accounts and shared movement/state through a disposable real Redis world; test keys were removed.
- Production deployment verified at https://vibe-city.net: two new accounts joined with separate characters, saw remote movement, and reloaded into saved progress with zero browser errors.
- Live server catalog reports one server, ten-player capacity and creation disabled. Vercel confirms the 00:00 UTC cron definition. Anonymous backup calls return 401. A direct authorized invocation of the same backup writer created today's production snapshot. The provider redacts the sensitive cron secret on export, so the authenticated HTTP cron path and a naturally scheduled midnight run have not been independently observed.
