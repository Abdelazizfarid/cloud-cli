import express from 'express';

import {
  buildLocalPayload,
  getSyncStatus,
  applyIncomingPayload,
  resolveConflicts,
} from '@/modules/sync/sync.service.js';
import type { SyncPayload, SyncResolveRequest } from '@/modules/sync/sync.types.js';

const router = express.Router();

// GET /api/sync/status - compare timestamps, return diff summary
router.get('/status', (_req, res) => {
  try {
    const status = getSyncStatus();
    res.json(status);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to get sync status' });
  }
});

// GET /api/sync/pull - return local data for remote to pull
router.get('/pull', (_req, res) => {
  try {
    const payload = buildLocalPayload();
    res.json({ payload });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to build sync payload' });
  }
});

// POST /api/sync/push - receive sync payload from remote instance
router.post('/push', (req, res) => {
  try {
    const payload = req.body as SyncPayload;
    if (!payload || !payload.timestamp) {
      res.status(400).json({ error: 'Invalid sync payload' });
      return;
    }
    const result = applyIncomingPayload(payload);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to apply sync payload' });
  }
});

// POST /api/sync/resolve - resolve conflicts with user choice
router.post('/resolve', (req, res) => {
  try {
    const { resolutions } = req.body as SyncResolveRequest;
    const remotePayload = req.body.remotePayload as SyncPayload | undefined;
    if (!resolutions || !Array.isArray(resolutions)) {
      res.status(400).json({ error: 'Invalid resolutions array' });
      return;
    }
    if (!remotePayload) {
      res.status(400).json({ error: 'remotePayload required for conflict resolution' });
      return;
    }
    const resolved = resolveConflicts(resolutions, remotePayload);
    res.json({ resolved });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to resolve conflicts' });
  }
});

export default router;
