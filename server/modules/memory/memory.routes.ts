import { promises as fsPromises } from 'fs';
import path from 'path';

import express from 'express';

import { projectsDb } from '@/modules/database/index.js';
import { WORKSPACES_ROOT } from '@/shared/utils.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

/** Express types route params as `string | string[]`; upstream narrows the same way. */
function routeParam(req: express.Request, name: string): string {
  const value = req.params[name];
  return typeof value === 'string' ? value : '';
}

/** Claude stores per-project state under ~/.claude/projects/<dash-encoded-path>/. */
function memoryDirFor(projectRoot: string): string {
  const encodedPath = projectRoot.replace(/\//g, '-').replace(/^-/, '');
  return path.join(WORKSPACES_ROOT, '.claude', 'projects', '-' + encodedPath, 'memory');
}

/** Join a caller-supplied file name onto a directory, refusing anything that escapes it. */
function resolveWithin(dir: string, name: string): string | null {
  const resolvedDir = path.resolve(dir);
  const resolved = path.resolve(resolvedDir, name);
  return resolved.startsWith(resolvedDir + path.sep) ? resolved : null;
}

export const claudeMdRoutes = express.Router();

claudeMdRoutes.get('/global', async (_req: express.Request, res: express.Response) => {
  const filePath = path.join(WORKSPACES_ROOT, '.claude', 'CLAUDE.md');
  try {
    const content = await fsPromises.readFile(filePath, 'utf8');
    res.json({ content, path: filePath });
  } catch (error) {
    if (isNotFound(error)) {
      res.json({ content: '', path: filePath, isNew: true });
    } else {
      res.status(500).json({ error: errorMessage(error) });
    }
  }
});

claudeMdRoutes.put('/global', async (req: express.Request, res: express.Response) => {
  try {
    const { content } = req.body ?? {};
    if (content === undefined) return res.status(400).json({ error: 'Content is required' });
    const claudeDir = path.join(WORKSPACES_ROOT, '.claude');
    await fsPromises.mkdir(claudeDir, { recursive: true });
    const filePath = path.join(claudeDir, 'CLAUDE.md');
    await fsPromises.writeFile(filePath, content, 'utf8');
    return res.json({ success: true, path: filePath });
  } catch (error) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

/**
 * Mounted at /api/projects, ahead of the upstream projects router so these
 * fork-specific sub-routes resolve first and unmatched paths fall through.
 */
export const projectMemoryRoutes = express.Router();

projectMemoryRoutes.get('/:projectId/claude-md', async (req: express.Request, res: express.Response) => {
  const projectRoot = projectsDb.getProjectPathById(routeParam(req, 'projectId'));
  if (!projectRoot) return res.status(404).json({ error: 'Project not found' });
  const filePath = path.join(projectRoot, 'CLAUDE.md');
  try {
    const content = await fsPromises.readFile(filePath, 'utf8');
    return res.json({ content, path: filePath });
  } catch (error) {
    if (isNotFound(error)) return res.json({ content: '', path: filePath, isNew: true });
    return res.status(500).json({ error: errorMessage(error) });
  }
});

projectMemoryRoutes.put('/:projectId/claude-md', async (req: express.Request, res: express.Response) => {
  try {
    const { content } = req.body ?? {};
    if (content === undefined) return res.status(400).json({ error: 'Content is required' });
    const projectRoot = projectsDb.getProjectPathById(routeParam(req, 'projectId'));
    if (!projectRoot) return res.status(404).json({ error: 'Project not found' });
    const filePath = path.join(projectRoot, 'CLAUDE.md');
    await fsPromises.writeFile(filePath, content, 'utf8');
    return res.json({ success: true, path: filePath });
  } catch (error) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

projectMemoryRoutes.get('/:projectId/memory-md', async (req: express.Request, res: express.Response) => {
  try {
    const projectRoot = projectsDb.getProjectPathById(routeParam(req, 'projectId'));
    if (!projectRoot) return res.status(404).json({ error: 'Project not found' });
    const memoryDir = memoryDirFor(projectRoot);
    try {
      const entries = await fsPromises.readdir(memoryDir);
      const files = [];
      for (const entry of entries) {
        const entryPath = path.join(memoryDir, entry);
        const stat = await fsPromises.stat(entryPath);
        if (stat.isFile()) files.push({ name: entry, path: entryPath, size: stat.size });
      }
      return res.json({ files, memoryDir });
    } catch (error) {
      if (isNotFound(error)) return res.json({ files: [], memoryDir });
      throw error;
    }
  } catch (error) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

projectMemoryRoutes.get('/:projectId/memory-md/:fileName', async (req: express.Request, res: express.Response) => {
  try {
    const projectRoot = projectsDb.getProjectPathById(routeParam(req, 'projectId'));
    if (!projectRoot) return res.status(404).json({ error: 'Project not found' });
    const filePath = resolveWithin(memoryDirFor(projectRoot), routeParam(req, 'fileName'));
    if (!filePath) return res.status(403).json({ error: 'Invalid path' });
    const content = await fsPromises.readFile(filePath, 'utf8');
    return res.json({ content, path: filePath, name: routeParam(req, 'fileName') });
  } catch (error) {
    if (isNotFound(error)) return res.status(404).json({ error: 'File not found' });
    return res.status(500).json({ error: errorMessage(error) });
  }
});

projectMemoryRoutes.put('/:projectId/memory-md/:fileName', async (req: express.Request, res: express.Response) => {
  try {
    const { content } = req.body ?? {};
    if (content === undefined) return res.status(400).json({ error: 'Content is required' });
    const projectRoot = projectsDb.getProjectPathById(routeParam(req, 'projectId'));
    if (!projectRoot) return res.status(404).json({ error: 'Project not found' });
    const memoryDir = memoryDirFor(projectRoot);
    await fsPromises.mkdir(memoryDir, { recursive: true });
    const filePath = resolveWithin(memoryDir, routeParam(req, 'fileName'));
    if (!filePath) return res.status(403).json({ error: 'Invalid path' });
    await fsPromises.writeFile(filePath, content, 'utf8');
    return res.json({ success: true, path: filePath });
  } catch (error) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});
