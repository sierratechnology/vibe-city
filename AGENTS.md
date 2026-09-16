# Vibe City: First Signal

This repository is an original sci-fi survival and construction game. It replaces the former agent/office interface by explicit owner direction. Do not restore Hermes, operational dashboards or the former product requirements.

- Keep local play free and runnable with `npm ci && npm start`.
- Shared rules live in `shared/`; server actions are authoritative.
- Support ten simultaneous players, mouse-only controls and phone touch controls.
- Preserve seeded world and player saves. Never publish credentials or local save data.
- Vercel production uses the cloud adapter and durable Redis transactions; local play uses JSON disk saves.
- Test gameplay, concurrency and save/reconnect behavior. Distinguish emulated touch from physical-device tests.
- Keep larger ambitions in docs/DESIGN.md and docs/ROADMAP.md without speculative infrastructure.
- Do not change production world keys or delete saves as part of routine deployment.
