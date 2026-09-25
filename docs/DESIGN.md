# Vibe City — design brief

## Identity

Vibe City is an original cooperative science-fiction survival and construction game. The player starts with a suit and field tools on an unfamiliar planet, with no spaceship. Discovery, ingenuity and the places players build together are the story. It is independent of the former Hermes/agent-interface project and does not inherit its operational dashboard or lore.

Valheim informs the rhythm of shared expeditions, preparation and earned capabilities. Minecraft informs expressive construction. Neither game's assets, fiction, naming, world generation or interface is reproduced.

**Visual direction:** weathered ivory equipment, dark blue-green metal, mint energy, coral sediment and pale lavender crystalline minerals. Silhouettes are simple, angular and readable. Civilization should look assembled, repaired and inhabited rather than like a pristine spacecraft showroom. The current field kit uses original Blender explorer, creature, vehicle and prop models with articulated movement; terrain and many structures remain lightweight geometry.

## World and progression

One server represents one procedurally generated solar system. Players initially inhabit a small planetary region. The long arc is surface survival → resilient settlement → advanced production → spacecraft → planetary and lunar expeditions → colonies and orbital stations. Interstellar travel and its relationship to server boundaries remain undecided.

Exploration reveals fragments: interrupted experiments, abandoned habitats, strange ruins and anomalies. Technology unlocks new activities and construction options. Avoid a compulsory cinematic campaign and let players tell stories through journeys, mistakes, rescues and the things they leave behind.

Later settlements can include inhabitants with jobs, player-built robots and drones for mining, farming and production. Persistent automation should eventually progress while players are away, with explicit resource budgets and simulation rules. It is **not** implemented in this milestone.

## First Signal: the vertical slice

A seeded 116 m playable basin contains ferrite, ribbon fiber, flux crystals, a landing marker and an ancient broken signal ring. Players gather, fabricate a cutter, recover an anchor pattern, build a canopy over a deck, and establish a powered foothold. Ion winds create a recurring reason to seek shelter. Shared resources and visible construction make cooperation useful immediately.

The ruin fragment — “We did not build the signal. We only taught it to wait.” — offers a mystery without assigning a quest giver or explaining the universe. The milestone can be finished, but the world remains open for construction afterward.

The current palette includes decks, bulkheads, canopies, anchors, perimeter barriers, wall lights and shared cargo lockers. Three original wildlife species, a shared day/night cycle, combat, meals and battery-powered flashlights add preparation and risk. Accounts support three selectable characters, each with a 60-item backpack. The current world extends over a spherical planet, with bounded hydroponic farming and ground vehicles. Voxel terrain destruction, spacecraft flight, NPC settlements, broad logistics and offline production remain planned.

## Technical decision

Three.js renders a browser-native client; a free local Node + WebSocket process runs the world. This is the smallest suitable stack with the installed JavaScript runtime and no Godot editor present. It avoids export pipelines and external realtime databases for this slice. Blender is installed, but authored primitive geometry is sufficient; an asset pipeline would add overhead without advancing the first loop.

Godot remains a reasonable future engine alternative. Its web export supports single-threaded execution, but browser platform constraints and separate server/client exports add work here. Native/mobile engine requirements should be reconsidered only after the browser prototype establishes the desired game feel.

The server validates movement speed, action distances, costs, unlocks, construction collisions and ownership. Clients share deterministic terrain and preview rules for feedback; the server remains authoritative. Saves use a simple versioned JSON file rather than speculative databases or distributed infrastructure. A solar system, sector streaming and background simulation are later changes, not hidden frameworks in this milestone.

The renderer uses instanced resource/decorative meshes, low-poly geometry, a capped device-pixel ratio, one shadow-casting light and a small terrain. Local movement prediction is intentionally basic; production networking will need robust reconciliation and latency testing.

## Design boundaries

- Real-time multiplayer and saved player progress are present now.
- Touch and mouse controls are implemented. Physical phones, controllers and every browser are not yet verified.
- Public hosting and portable accounts are available; offline automation remains future work.
- A finite seeded terrain patch is not a full simulated planet or solar system.
- A fully enclosed room is not required for shelter in this slice: a canopy tile is enough.
- Completion requires the unlocked player to stand beneath a canopy inside an anchor field.

References consulted for the stack decision: [Three.js renderer](https://threejs.org/docs/pages/WebGLRenderer.html), [Godot web export](https://docs.godotengine.org/en/4.5/tutorials/export/exporting_for_web.html).

## Public prototype update
The public deployment uses Vercel WebSockets and an Upstash Redis world shared through atomic compare-and-set transactions. Local development remains disk-backed. Admission is capped at fifty simultaneous characters. Passwords use salted scrypt hashes; HttpOnly sessions gate character ownership. Daily world snapshots run at 00:00 UTC alongside frequent active-world saves. Password recovery, owner-managed administrators/moderators, construction permissions and bounded Coral Flux regeneration are implemented. Broader renewable resource systems remain planned.

## Shared survival loop — September 24
Backpack grids expose item use, belt assignment and resource dropping. Recipes are searchable and categorized with have/need counts and one browser-local tracked list. Bulk storage transfers remain server-authoritative, capacity-bounded and subject to existing access controls. Characters can claim an owned bunk for recovery, with clear-space checks and landing fallback. Optional saved expedition milestones live inside the guide. Distinct original sounds, work/landing poses, tool sparks and bounded crowd nameplates support readability. See the research and validation record in docs/research/survival-loop-2026-09-24.md.
