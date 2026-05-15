# VAM Flight HUD — Discord Activity

Welle N / N5 skeleton for a Discord Activity (embedded mini-app) that
displays live VAM flight status inside a Discord voice channel.

## Status

**Skeleton.** The TypeScript and HTML are structurally complete and
should run locally with `npm install && npm run dev`. To actually
launch from inside Discord, you need to register an Activity in the
Discord Developer Portal and connect it to a dev-tunnel (see Setup
below).

## What it does

Polls `GET /api/embed/state/[token]` on the VAM server every 8s and
renders ALT / GS / HDG / route in a small dark card. The token is
generated at `/settings/embeds` on the VAM side and pasted into the
activity on first launch (stored in `localStorage`).

The displayed flight is whatever VAM pilot owns the embed-token —
typically the same user who's launched the activity, but it could
also be e.g. an airline streamer broadcasting their squadmate's
flight.

## File layout

```
discord-activity/
├── index.html          single-page DOM with three views (setup / flight / empty)
├── src/main.ts         entry — DiscordSDK init + poll loop + render
├── package.json        Vite + @discord/embedded-app-sdk
├── vite.config.ts      dev-server with permissive CORS
└── tsconfig.json
```

## Local dev

```sh
cd discord-activity
npm install
npm run dev          # Vite serves at http://localhost:5173
```

Outside Discord, `DiscordSDK.ready()` will throw — the code catches
and continues so you can preview the UI in a normal browser. The
"Save token" button works; polling against `vam.kevindrack.de` works
if your token is valid.

## Registering with Discord

To launch the activity from inside Discord:

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
   and create a new Application.
2. Enable **Activities** and configure URL Mappings:
   - Root mapping `/` → your prod CDN URL (where `dist/` is hosted)
3. Copy the Application ID, paste it into `DISCORD_CLIENT_ID` in
   `src/main.ts` (the current `REPLACE_WITH_YOUR_DISCORD_APP_ID`
   placeholder).
4. For dev: install [discord-tunnel](https://discord.com/developers/docs/activities/development-guides/local-development)
   to expose your local Vite server to Discord through the desktop
   client.
5. Right-click a voice channel → Activities → your activity should
   appear in the list.

## Production deploy

1. `npm run build` → emits `dist/`
2. Host `dist/` on any static CDN with HTTPS (Cloudflare Pages,
   Vercel, S3 + CloudFront). Discord requires HTTPS for activity URLs.
3. Update the Developer-Portal URL Mapping to point at the CDN.

## Token UX

The first-launch screen asks the user to paste a `vame_*` token from
`/settings/embeds`. We chose this over Discord OAuth because:

- No server-side coupling between the activity and the existing
  User.discordId column (which is used by the milestone-bot for
  mentions — different purpose).
- Pilots can share their own activity with friends ("look at my flight")
  by handing over a read-only token; no need to grant anything via
  Discord OAuth.
- v2 can add a Discord-OAuth path that resolves the activity-user's
  Discord ID → VAM userId server-side; the existing token path stays
  as fallback.

## Future

- **Spectator mode**: token-owner-only viewing today. A "channel-shared"
  mode where the activity-initiator picks a flight and other voice-
  members see the same readout would need RPC events from `@discord/
  embedded-app-sdk` (channel-state-update).
- **Multi-pilot board**: instead of one flight, display all currently-
  live pilots from the activity-initiator's airline. Needs a new
  `/api/embed/airline/[token]` endpoint that returns a flight list.
- **Direct dispatch**: in-activity buttons that fire a webhook back to
  the VAM server (e.g. "✋ I want this gate" → dispatch-board update).
  Needs a write-scoped token model.
