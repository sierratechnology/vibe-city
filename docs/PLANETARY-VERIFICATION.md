# Planetary Expedition verification — development build

## Passed
- 34 automated rule/integration tests: fifty verified clients and overflow/released-seat handling; concurrent cloud admission; saved progression; great-circle circumnavigation math, longitude/pole crossing; deterministic streamed deposits and depletion save/reload; room sealing, airlocks, breach behavior, safe sleep quorum; PIN access/redaction/revocation/guess limits; rover driving and passengers; PvP/settings checks; email verification replay and duplicate-email protection; unprivileged admin denial.
- Two local rendered browsers completed real gather → cutter → ruin → four-piece construction → powered shelter, then restarted the server with persistent inventory and structures. No fixture materials for this core-loop test. Sample: 60 FPS, 71 draw calls, 31,828 triangles.
- Explicit fixture browser tests covered account verification through the real token flow, three characters, shared cargo, night creatures/lights/food, rover construction and driver/passenger movement, map markers, atmosphere scans, persistent tips, restricted admin controls, and rendering at quarter-planet, polar and longitude-seam positions.
- Browser screenshots inspected. Fixed vehicle Euler orientation, rover camera distance and local surface lighting during visual review.
- Touch-emulated movement, gathering, multitouch cancellation, phone UI and mouse-only movement passed. Physical phone, Safari and sustained fifty-rendered-client performance are not tested.
- Two independent server processes used real Redis under a guarded disposable UUID namespace, with test-only local email delivery. Live world/account keys were prohibited. After correcting latency handling, movement covered 20.26 metres over five seconds (nominal walking 21 metres). All disposable test keys were cleaned up.
- Production build passed. No credentials or save data in browser output.

## Latest rerun
- All 34 automated tests and the production build passed after the tangent-grid and camera/input changes.
- Expedition browser checks passed, including tips remaining off after reload.
- The core two-browser check passed through construction and restart persistence on rerun. Its first run timed out while steering to a target (0.74 m short); the cause is not established, so movement automation remains a reliability follow-up.

## Release setup
- The existing Resend free account supports this sender domain. No paid subscription was created. `mail.vibe-city.net` is verified with a domain-restricted sending key stored as a Vercel production secret.
- One authorized delivery-test email to the owner address was marked delivered by Resend on September 16, 2026.
- The wiki DNS-only CNAME resolves publicly to the project's Vercel DNS target.
- MASTER_ADMIN_EMAIL, PUBLIC_URL, MAIL_FROM and RESEND_API_KEY are configured. Master access still requires verified ownership of the designated email.
- A separate durable pre-release world backup was created at 2026-09-16T22:25:47.846Z (9 structures, 10 saved players). The live save key was not reset.
- Production deployment and public smoke checks are pending at the time of this release-candidate commit.

## Explicit scope limits
The first monument locations are authored around the landing region; richer randomized interiors and distant variants remain future work. Construction is currently one storey; structural weight, stairs and multi-level rooms are not implemented. Vehicle attachment machinery and automated pipes are future work. There are no offline sleeper bodies or corpse-loot mechanics. The six-hour rover journey is derived from size/speed and traversal math; nobody has driven a full six-hour circuit during testing. Local tangent construction grids were checked for three-metre spacing and sealed rooms at polar and longitude-seam locations; larger bases still need human playtesting.
