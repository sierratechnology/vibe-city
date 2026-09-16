# Vibe City: First Signal

**Live: https://vibe-city.net — up to 10 simultaneous explorers, mouse or phone touch.**

An original, small, playable 3D survival and construction game. Original procedural art and no Hermes integration. Username/password accounts support three characters each. A real Node server owns a shared world; browsers render it with Three.js.

## Launch on your Mac

Requires Node.js 22 or newer. In Terminal:

```sh
cd "/Users/devon/Documents/GitHub/vibe-city"
npm ci
npm start
```

Open **http://localhost:4173** in Chrome. Once dependencies are installed, internet is not required. Stop the server with **Control-C** to save and shut down cleanly. Alternatively double-click `Launch Vibe City.command` on macOS (Terminal may request permission).

## Play together in real time

1. Keep `npm start` running on the host Mac.
2. Choose **Find / Join Game**, create an account, create a character, and join. For a second player, use a separate browser profile/account or select a different character.
3. On a second computer on the same Wi-Fi/LAN, visit `http://HOST_IP:4173`. Find the Mac's IP in System Settings → Wi-Fi → Details → TCP/IP, or run `ipconfig getifaddr en0`.
4. Allow Node/Terminal through the macOS firewall if prompted. Guest Wi-Fi with client isolation may prevent devices from reaching each other.
5. Both players see one another, share deposits and construction, and keep separate inventories. The server supports ten simultaneous explorers; admission was verified with ten WebSocket clients. Two rendered clients remain the full-loop performance test.

The public game is available at https://vibe-city.net with HTTPS, secure account cookies and server-validated character ownership. Local development is intended for your trusted LAN. Mouse-only and phone touch controls are implemented; physical phone performance still needs verification.

## Controls

| Input | Action |
| --- | --- |
| Click/tap world | Walk toward terrain; place while building |
| Drag world | Orbit camera |
| Wheel | Camera distance |
| W A S D | Move relative to camera |
| Shift | Sprint; uses more suit charge |
| E (hold) | Gather nearest resource; scan nearby ruin |
| C | Fabrication, inventory and field guide |
| B | Toggle construction preview |
| 1 / 2 / 3 / 4 | Deck / bulkhead / canopy / resonance anchor |
| R | Rotate bulkhead to another edge |
| Place button / click world | Place preview |
| X | Dismantle your closest piece, full refund |
| Escape | Close guide or construction mode |

Previews snap 4.5 m ahead onto a 3 m grid. Green means valid and affordable, red means blocked. The on-screen hint explains why. Place a deck first; walls, a canopy and an anchor attach to it. Keep an edge open as the doorway. Dismantle upper pieces before their deck.

## The first loop (roughly 5–10 minutes)

- Gather **3 ferrite + 2 ribbon fiber** near the landing point. Press C and craft the field cutter; gathering gets faster.
- Build shelter if needed: **deck = 2 ferrite + 1 fiber**, **canopy = 1 ferrite + 3 fiber**. A bulkhead costs 2 ferrite.
- Follow the broken ring northeast. The compass gives world bearing and distance. At its central console, press E with a cutter equipped.
- The ruin unlocks a **resonance anchor** and supplies 3 flux crystals. Construct an anchor for **4 ferrite + 3 crystals** on a deck.
- Stand under a canopy within 7 m of your anchor to complete First Signal. Keep exploring and building afterward.

Suit charge drains slowly outside shelter, faster while sprinting and during 45-second ion winds every 150 seconds. A canopy restores charge; an anchor restores it faster. Empty charge damages health. At zero health, you recover at the landing point with your inventory intact. Wildlife combat and crafted healing meals are available; there is no hunger meter.

## Saving and loading

The host stores `data/world.json`: seed, world time, structures, depleted resources, player positions, inventories, equipment and discovery progress. It saves after successful actions, every five seconds, on disconnect and on clean shutdown. A temporary file is renamed over the save to avoid partially written JSON. Back up this file while the server is stopped.

Accounts use salted scrypt password hashes and seven-day HttpOnly sessions. Each account can create up to three characters with separate inventories and progress. Sign into the same account on another device to select your characters. Password recovery and character deletion are not available yet. Local accounts are stored in `data/accounts.json`; back it up alongside `world.json`. Public accounts live in Redis separately from the world snapshot.

Backpacks hold **60 item units total**; equipped tools do not take space. **Cargo lockers hold 200 units**, cost 6 ferrite + 2 fiber, and can be placed on terrain. Approach within 3 m and choose Storage to deposit/withdraw a chosen quantity. Lockers are shared, and must be emptied before the builder dismantles them. Full inventories reject additional items; hunting and ruin rewards leave overflow on the ground.

Existing anonymous pilot records and shared structures are preserved, but newly created account characters start fresh. Anonymous pilot inventory and building ownership are not automatically claimed by an account. Server restart reloads the existing save; `SEED` only applies to a new world.

```sh
# A separate seeded expedition; leaves the default save intact:
SEED=90210 SAVE_FILE=./data/expedition-90210.json PORT=4174 npm start
# Bind only to this machine:
HOST=127.0.0.1 npm start
```

The world runs while the server runs. Disconnected players do not move or consume suit charge. There is no offline automation or time catch-up yet. A damaged/incompatible save fails loudly instead of silently discarding progress.

## Verification

```sh
npm test
npm run test:browser
```

Unit tests cover the core loop, validation, depletion races, collision, survival, refunds and persistence. Browser tests launch two isolated Chrome contexts against a temporary real server, play via keyboard/UI, verify shared changes and restart persistence, then remove their temporary save. On macOS, Chrome is expected in `/Applications/Google Chrome.app`; override with `CHROME_PATH=/path/to/chrome`. Test screenshots/report go to `docs/`. No test inventory or structures are inserted into your live world.

See [verification notes](docs/VERIFICATION.md), [design](docs/DESIGN.md), and [roadmap](docs/ROADMAP.md).

## Code map

- `shared/world.js` — seeded generation, recipes, terrain height, geometry/collision and placement rules.
- `server/game.js` — authoritative movement, survival and action transactions.
- `server/index.js` — HTTP/WebSocket transport, sessions, 20 Hz simulation and 10 Hz state snapshots.
- `server/persistence.js` — versioned disk save/load.
- `client/main.js` — rendering, input, camera, UI and lightweight local movement prediction.
- `tests/` — isolated game rules and two-browser end-to-end verification.

No build/bundle step is needed. All browser code and dependencies are served locally. All placeholder geometry and visual design were authored for this prototype in source. Third-party software retains its licenses in `node_modules` (Three.js, ws, Playwright: MIT / Apache-2.0 as applicable).

## Online deployment (September 16 update)

The repository now supports Vercel Functions WebSockets at `/api/ws`, with an Upstash Redis world shared across function instances. `server/cloud-store.js` uses optimistic compare-and-set transactions so competing instances cannot fork the room or admit more than ten players. `server/cloud-room.js` advances the world and validates actions; sessions expire after lost connections. Browsers reconnect automatically when a platform connection is recycled.

`KV_REST_API_URL` and `KV_REST_API_TOKEN` are server-only environment variables supplied by the Vercel integration. Never put them in client code. Production and preview use distinct world keys. Local `npm start` still uses the free disk-backed server and does not require Redis.

The free storage plan has usage limits; it is suitable for an initial playtest, not an unlimited always-busy game service. World processing runs only with connected players. A future dedicated server can reuse the local authoritative game implementation if traffic outgrows this hosting model.

### Mouse and touch controls

No keyboard is required. Click/tap terrain to walk toward it; drag the world to orbit. On touch-capable devices, drag the movement pad for precise steering. The pad is hidden on non-touch computers. Use Gather/Scan (hold to repeat), Sprint, Build, Place, Rotate, Dismantle, and +/− buttons. Open Field Guide for crafting. The hotbar selects construction pieces. Click-to-walk follows a straight line and stops at obstacles; use the pad to steer around them.

## The Living Basin update

From the title choose **Find / Join Game**, then join **The Quiet Basin**. The directory shows live occupancy (10-player maximum). **Create Server** is deliberately disabled until the owner enables additional servers; there is no create-server endpoint.

- **Day/night:** six minutes of daylight and four minutes of night per shared simulation cycle. All players see the same phase; cloud simulation pauses when empty.
- **Mossback:** neutral at all hours. Hunt with Attack to obtain meat. Prepare a Field meal using 1 meat + 1 ribbon fiber; Eat restores 35 health.
- **Bristletick:** small hostile creature, active day and night.
- **Veilstalker:** medium hostile creature, appears and attacks only at night. Defeating one yields flux crystals.
- **Combat:** Attack targets the nearest creature within 2.8 m with a clear path. Bare hands deal 8 damage, the crafted cutter 15. Creatures respawn after three simulation minutes. The immediate landing area is a safe zone.
- **Building walls:** Bulkheads still require decks. **Camp barriers** are freestanding perimeter walls costing 3 ferrite + 1 fiber. They block movement and creature attacks; leave an opening for entry.
- **Wall lumen:** costs 1 ferrite + 1 flux crystal. Place on the same grid tile and rotated edge as an existing bulkhead or barrier. Remove the lamp before dismantling its supporting wall. Lamps stay on and do not drain suit charge. Up to six nearby wall lights illuminate geometry at once to limit mobile rendering cost; all lamp fixtures remain visible.
- **Suit flashlight:** craft for 2 ferrite + 1 flux crystal. Toggle Light (F). The forward beam follows camera aim, is visible to other players, drains 0.65 extra charge per second and turns off at zero charge.
- **Camera:** closer third-person follow, smooth orbit/follow, wheel or +/− zoom (2.5–12 m), and collision avoidance against terrain and buildings. Mouse drag or touch swipe rotates the view.
- **New shortcuts:** Space attacks, F toggles flashlight, H eats a meal; 5 selects barriers and 6 selects wall lights. All actions also have mouse/touch buttons.

### Daily saves

Frequent transactional cloud saves and local five-second saves remain enabled. An additional Vercel Cron job runs at **00:00 UTC daily** and stores an immutable snapshot with eight-day retention. The `/api/daily-save` endpoint requires the server-only `CRON_SECRET`; it is not an anonymous backup or reset endpoint. The same date cannot overwrite an earlier snapshot. Local servers create dated backups when crossing UTC midnight while running. A stopped local server cannot execute a scheduled backup.

Existing worlds upgrade in place: player items, structures, world time and resource depletion are preserved. The first successful cloud transaction persists the new creature population and player item fields.
