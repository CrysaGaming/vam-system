import express, { Request, Response, NextFunction } from 'express';
import type { Client } from 'discord.js';
import { env } from './env.js';
import { handlePirepSubmitted } from './events/pirep-submitted.js';
import { handleRankUpgraded } from './events/rank-upgraded.js';
import { handlePirepApproved } from './events/pirep-approved.js';
import { handlePirepRejected } from './events/pirep-rejected.js';

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

  // Fallback 404
  app.use((req, res) => {
    res.status(404).json({ error: 'not-found', path: req.path });
  });

  app.listen(env.http.port, () => {
    console.log(`HTTP server listening on http://localhost:${env.http.port}`);
  });

  return app;
}