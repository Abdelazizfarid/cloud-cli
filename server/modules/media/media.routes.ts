import path from 'path';

import express from 'express';
import jwt from 'jsonwebtoken';

import { authenticateToken } from '@/modules/auth/index.js';
import { appConfigDb } from '@/modules/database/index.js';
import { WORKSPACES_ROOT } from '@/shared/utils.js';

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
};

const VIEWABLE_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];

function mimeFor(filePath: string): string {
  return IMAGE_MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Resolve a caller-supplied absolute path and require it to stay inside
 * WORKSPACES_ROOT. The fork's original handlers only rejected literal '..'
 * segments, which still allowed reads anywhere on the filesystem; resolving
 * first and then enforcing containment closes that.
 */
function resolveInWorkspace(candidate: string): string | null {
  const resolved = path.resolve(candidate);
  const root = path.resolve(WORKSPACES_ROOT);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

function jwtSecret(): string {
  return process.env.JWT_SECRET || appConfigDb.getOrCreateJwtSecret();
}

/**
 * Session images written by agent runs. Unauthenticated by design: the paths
 * contain per-run random segments and are handed to the browser as plain <img>
 * sources, which cannot carry an Authorization header.
 */
export const imagesRoutes = express.Router();

imagesRoutes.get('/*', (req: express.Request, res: express.Response) => {
  const requestedPath = '/' + ((req.params as unknown as string[])[0] ?? '');
  if (!requestedPath.includes('/.tmp/images/')) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const filePath = resolveInWorkspace(requestedPath);
  if (!filePath || !filePath.includes('/.tmp/images/')) {
    return res.status(403).json({ error: 'Access denied' });
  }
  return res.sendFile(filePath, { headers: { 'Content-Type': mimeFor(filePath) } }, (err) => {
    if (err) res.status(404).json({ error: 'File not found' });
  });
});

export const screenshotsRoutes = express.Router();

/** View a screenshot through a short-lived signed token (no session cookie needed). */
screenshotsRoutes.get('/view', (req: express.Request, res: express.Response) => {
  const token = req.query.token;
  if (typeof token !== 'string' || !token) {
    return res.status(400).json({ error: 'Missing token' });
  }
  try {
    const decoded = jwt.verify(token, jwtSecret()) as { path?: unknown; purpose?: unknown };
    if (decoded.purpose !== 'screenshot' || typeof decoded.path !== 'string') {
      return res.status(403).json({ error: 'Invalid token' });
    }
    const filePath = resolveInWorkspace(decoded.path);
    if (!filePath) return res.status(403).json({ error: 'Invalid path' });
    return res.sendFile(
      filePath,
      { headers: { 'Content-Type': mimeFor(filePath), 'Cache-Control': 'private, max-age=3600' } },
      (err) => {
        if (err) res.status(404).json({ error: 'File not found or expired' });
      },
    );
  } catch {
    return res.status(401).json({ error: 'Token expired or invalid' });
  }
});

/** Mint a 1-hour signed URL for a screenshot path. */
screenshotsRoutes.post('/sign', authenticateToken, (req: express.Request, res: express.Response) => {
  const { filePath } = req.body ?? {};
  if (!filePath || typeof filePath !== 'string') {
    return res.status(400).json({ error: 'filePath required' });
  }
  const resolved = resolveInWorkspace(filePath);
  if (!resolved) return res.status(403).json({ error: 'Invalid path' });
  const token = jwt.sign({ path: resolved, purpose: 'screenshot' }, jwtSecret(), { expiresIn: '1h' });
  return res.json({ url: `/api/screenshots/view?token=${encodeURIComponent(token)}`, expiresIn: 3600 });
});

/** Direct authenticated read of a screenshot file. */
screenshotsRoutes.get('/file', authenticateToken, (req: express.Request, res: express.Response) => {
  const requested = req.query.path;
  if (typeof requested !== 'string' || !requested) {
    return res.status(400).json({ error: 'Invalid path' });
  }
  const filePath = resolveInWorkspace(requested);
  if (!filePath) return res.status(403).json({ error: 'Invalid path' });
  if (!VIEWABLE_IMAGE_EXTENSIONS.includes(path.extname(filePath).toLowerCase())) {
    return res.status(400).json({ error: 'Not an image file' });
  }
  return res.sendFile(
    filePath,
    { headers: { 'Content-Type': mimeFor(filePath), 'Cache-Control': 'private, max-age=3600' } },
    (err) => {
      if (err) res.status(404).json({ error: 'File not found' });
    },
  );
});
