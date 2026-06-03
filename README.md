# Vibe City

Vibe City is a seasonal multiplayer city simulation game where citizens, businesses, schedules, relationships, and information systems create a living downtown district.

## Current Status

- 3D isometric district
- Shared world time
- Citizens with schedules
- Businesses and staffing
- Relationships and knowledge journal
- Phone-style UI
- Deployed at https://vibe-city.net

## Tech Stack

- Vite
- TypeScript
- Three.js
- Vercel

## Local Setup

```bash
npm install
npm run dev
npm run build
```

## Multiplayer Environment

Vibe City uses Supabase Realtime presence for multiplayer visibility.

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

- `npm run dev` starts the local Vite dev server.
- `npm run build` type-checks and builds the production bundle.
- `npm run preview` serves the production build locally.

## Roadmap

- Touchscreen controls
- Multiplayer
- Business leasing
- Player-run businesses
- Economy
- Seasonal leaderboard

## Deployment

The app is a static Vite site and can be deployed to Vercel with the default build command:

- Build command: `npm run build`
- Output directory: `dist`

### Vercel Environment Variables

Add these variables in Vercel:

1. Open the Vercel project for Vibe City.
2. Go to **Settings → Environment Variables**.
3. Add `VITE_SUPABASE_URL`.
4. Add `VITE_SUPABASE_ANON_KEY`.
5. Save them for Production, Preview, and Development as needed.

After adding or changing Vercel env vars, redeploy production. Vercel does not inject new build-time Vite env vars into an already-built deployment.

```bash
vercel --prod
```
