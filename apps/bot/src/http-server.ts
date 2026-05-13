import express, { Request, Response, NextFunction } from 'express';
import type { Client } from 'discord.js';
import { env } from './env.js';
import { handlePirepSubmitted } from './events/pirep-submitted.js';
import { handleRankUpgraded } from './events/rank-upgraded.js';
import { handlePirepApproved } from './events/pirep-approved.js';
import { handlePirepRejected } from './events/pirep-rejected.js';
import { handleAwardEarned } from './events/award-earned.js';
import { handleEventPublished } from './events/event-published.js';
import { getPublicVatsimPilots, getPublicVatsimControllers } from './services/vatsim-tracker.js';
import { getPublicIvaoPilots } from './services/ivao-tracker.js';
import { getCachedMetars } from './services/metar-tracker.js';

export function startHttpServer(client: Client) {
  const app = express();
  app.use(express.json());

  // Auth middleware: prüft Authorization-Header gegen BOT_EVENTS_SECRET
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/health') return next(); // Health-Check ohne Auth

    const auth = req.headers.authorization;
    if (auth !== `Bearer ${env.http.secret}`) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  });

  // Health-Check (ohne Auth)
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      bot: client.user?.tag ?? 'not-ready',
      uptime: process.uptime(),
    });
  });

  // Event: PIREP eingereicht
  app.post('/events/pirep-submitted', async (req, res) => {
    try {
      await handlePirepSubmitted(client, req.body);
      res.json({ ok: true });
    } catch (err) {
      console.error('Failed to handle pirep-submitted:', err);
      res.status(500).json({ error: 'failed' });
    }
  });

  // Event: Rank Upgrade
  app.post('/events/rank-upgraded', async (req, res) => {
    try {
      await handleRankUpgraded(client, req.body);
      res.json({ ok: true });
    } catch (err) {
      console.error('Failed to handle rank-upgraded:', err);
      res.status(500).json({ error: 'failed' });
    }
  });

  // Event: PIREP Approved
  app.post('/events/pirep-approved', async (req, res) => {
    try {
      await handlePirepApproved(client, req.body);
      res.json({ ok: true });
    } catch (err) {
      console.error('Failed to handle pirep-approved:', err);
      res.status(500).json({ error: 'failed' });
    }
  });

  // Event: PIREP Rejected
  app.post('/events/pirep-rejected', async (req, res) => {
    try {
      await handlePirepRejected(client, req.body);
      res.json({ ok: true });
    } catch (err) {
      console.error('Failed to handle pirep-rejected:', err);
      res.status(500).json({ error: 'failed' });
    }
  });

  // Event: Award Earned (Track 1 #1)
  app.post('/events/award-earned', async (req, res) => {
    try {
      await handleAwardEarned(client, req.body);
      res.json({ ok: true });
    } catch (err) {
      console.error('Failed to handle award-earned:', err);
      res.status(500).json({ error: 'failed' });
    }
  });

  // Event: Event Published (Track 1 #7) — postet announcement-embed
  // im #announcements channel mit @event-notifications-rolle ping.
  app.post('/events/event-published', async (req, res) => {
    try {
      await handleEventPublished(client, req.body);
      res.json({ ok: true });
    } catch (err) {
      console.error('Failed to handle event-published:', err);
      res.status(500).json({ error: 'failed' });
    }
  });

  // Public live tracking data (all VATSIM + IVAO pilots, in-memory cache)
  app.get('/public-pilots', (_req, res) => {
    const vatsim = getPublicVatsimPilots();
    const ivao = getPublicIvaoPilots();
    res.json({
      vatsim: {
        count: vatsim.pilots.length,
        updatedAt: vatsim.updatedAt?.toISOString() ?? null,
        pilots: vatsim.pilots,
      },
      ivao: {
        count: ivao.pilots.length,
        updatedAt: ivao.updatedAt?.toISOString() ?? null,
        pilots: ivao.pilots,
      },
    });
  });

  // METARs für relevante Airports (DB + aktive Member-Sessions)
  app.get('/metars', (_req, res) => {
    const metars = getCachedMetars();
    res.json({
      count: Object.keys(metars).length,
      metars,
    });
  });

  // ─── Welle B — B2 phase 2B. ATC controllers online (VATSIM) ────────
  // Returns the current snapshot of online VATSIM controllers as cached
  // by the vatsim-tracker. The vam-web ATC-matcher polls this to look
  // up which controller a pilot is tuned to based on their COM1 active-
  // frequency at heartbeat time.
  //
  // Why VATSIM-only in v1: IVAO is a much smaller network (~10% of VATSIM
  // pilot traffic at peak) and the IVAO tracker doesn't yet poll their
  // ATC datafeed. Future B2.x can add IVAO with the same shape.
  //
  // Returned shape is the pre-parsed PublicController array (see vatsim-
  // tracker.ts docstring) — frequencyMhz already a number, facilityType
  // already a string. No bot-side filtering by region/proximity; the
  // matcher does that against the pilot's lat/lng so the same cache
  // serves multiple ACARS clients without recomputation.
  app.get('/atc/online', (_req, res) => {
    const vatsim = getPublicVatsimControllers();
    res.json({
      vatsim: {
        count: vatsim.controllers.length,
        updatedAt: vatsim.updatedAt?.toISOString() ?? null,
        controllers: vatsim.controllers,
      },
    });
  });

  // Fallback 404
  app.use((req, res) => {
    res.status(404).json({ error: 'not-found', path: req.path });
  });

  app.listen(env.http.port, () => {
    console.log(`HTTP server listening on http://localhost:${env.http.port}`);
  });

  return app;
}