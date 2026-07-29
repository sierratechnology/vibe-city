# STG World Zero

World Zero is the first STG Operating System headquarters world. It keeps the reusable Vite, TypeScript, Three.js, movement, camera, rendering, schedule, phone, debug, and Supabase presence mechanics while replacing the old city content with the STG Headquarters foundation.

## Current Status

- Empty exterior world with one single-story STG Headquarters building
- STG Headquarters interior with Reception Area, Meeting / Boardroom, Assistant Office, Devon's Executive Office, Projects & Updates Office, and Entrance / Exit Door
- One active agent: `agent_exec_assistant_001`
- Agent/profile seed fields for future STG agents
- Shared world time
- Phone-style UI
- Debug health state and Supabase presence diagnostics
- Deployed target: https://vibe-city.net

## Tech Stack

- Vite
- TypeScript
- Three.js
- Supabase Realtime presence
- Vercel

## Local Setup

```bash
npm install
npm run dev
npm run build
```

Milestone 3 local authenticated work records use the combined local server rather than a static Vite process. See [`docs/WORK_RECORDS_LOCAL_PROTOTYPE.md`](docs/WORK_RECORDS_LOCAL_PROTOTYPE.md) for the versioned privacy-safe event contract, runtime-only bearer token setup, SQLite persistence, ingestion helper, and verification steps.

## Multiplayer Environment

World Zero uses Supabase Realtime presence for multiplayer visibility.

The app reads these Vite environment variables:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Create a local env file:

```bash
cp .env.example .env.local
```

Then fill in `.env.local` with your Supabase project URL and anon key.

If either value is missing, multiplayer will not be faked. The HUD and debug panel will show:

```text
Multiplayer: Offline / Missing Env
```

When both values are present and Realtime connects, the HUD will show:

```text
Multiplayer: Connected
```

## Scripts

- `npm run dev` starts the combined local Vite development server and loopback work-record API.
- `npm run build` type-checks and builds the production bundle.
- `npm run preview` serves the production build locally.
- `npm start` serves the production bundle and loopback work-record API.

## World Zero Refactor Notes

- Old Fremont/casino/bar/business building placements were removed from the generated world.
- Old citizen and filler NPC seeds were replaced by the single Executive Assistant agent.
- Old business definitions were replaced by STG Headquarters Operations.
- The old scene transition mechanics remain, but only the STG Headquarters entrance/exit is active.
- The historical `window.__vibeCity3DHealth` debug alias is preserved for existing health checks.

## Roadmap

- Add future STG offices and buildings when requested
- Add additional agents after Agent #001 foundation is stable
- Connect real project, repo, deployment, and device sources
- Expand decision queue and meeting coordination behavior

## Deployment

The app is a static Vite site and can be deployed to Vercel with the default build command:

- Build command: `npm run build`
- Output directory: `dist`

### Vercel Environment Variables

Add these variables in Vercel:

1. Open the Vercel project for World Zero.
2. Go to **Settings -> Environment Variables**.
3. Add `VITE_SUPABASE_URL`.
4. Add `VITE_SUPABASE_ANON_KEY`.
5. Save them for Production, Preview, and Development as needed.

After adding or changing Vercel env vars, redeploy production. Vercel does not inject new build-time Vite env vars into an already-built deployment.

```bash
vercel --prod
```
