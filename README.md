# Vibe City: First Signal

An original, small, playable 3D survival and construction game. No Hermes integration, accounts, paid services, downloaded art, or external game assets. A real Node server owns a shared world; browsers render it with Three.js.

## Launch on your Mac

Requires Node.js 22 or newer. In Terminal:

```sh
cd "/Users/devon/Documents/Codex/2026-09-14/t/outputs/vibe-city-first-signal"
npm ci
npm start
```

Open **http://localhost:4173** in Chrome. Once dependencies are installed, internet is not required. Stop the server with **Control-C** to save and shut down cleanly. Alternatively double-click `Launch Vibe City.command` on macOS (Terminal may request permission).

## Play together in real time

1. Keep `npm start` running on the host Mac.
2. On the same Mac, open two tabs and choose **different pilot slots** before joining.
3. On a second computer on the same Wi-Fi/LAN, visit `http://HOST_IP:4173`. Find the Mac's IP in System Settings → Wi-Fi → Details → TCP/IP, or run `ipconfig getifaddr en0`.
4. Allow Node/Terminal through the macOS firewall if prompted. Guest Wi-Fi with client isolation may prevent devices from reaching each other.
5. Both players see one another, share deposits and construction, and keep separate inventories. The server supports ten simultaneous explorers; admission was verified with ten WebSocket clients. Two rendered clients remain the full-loop performance test.

This is a trusted local-network prototype. Remote internet play requires a reachable host, HTTPS/WSS and proper authentication/deployment work. Do not expose this development server directly to the public internet. There is no paid relay dependency. Mouse-only and phone touch controls are implemented; physical phone performance still needs verification.

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

Suit charge drains slowly outside shelter, faster while sprinting and during 45-second ion winds every 150 seconds. A canopy restores charge; an anchor restores it faster. Empty charge damages health. At zero health, you recover at the landing point with your inventory intact. There is no combat or hunger yet.

## Saving and loading

The host stores `data/world.json`: seed, world time, structures, depleted resources, player positions, inventories, equipment and discovery progress. It saves after successful actions, every five seconds, on disconnect and on clean shutdown. A temporary file is renamed over the save to avoid partially written JSON. Back up this file while the server is stopped.

Pilot identities live in browser local storage, separately per slot. Reuse the same browser, URL and slot to resume. `localhost` and a LAN IP are different browser origins. Clearing site data loses access to that pilot; account portability is a future milestone. Tokens are not included in shared snapshots. Server restart reloads the existing save; `SEED` only applies to a **new** save.

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

No keyboard is required. Click/tap terrain to walk toward it; drag the world to orbit. Drag the movement pad for precise steering. Use Gather/Scan (hold to repeat), Sprint, Build, Place, Rotate, Dismantle, and +/− buttons. Open Field Guide for crafting. The hotbar selects construction pieces. Click-to-walk follows a straight line and stops at obstacles; use the pad to steer around them.
