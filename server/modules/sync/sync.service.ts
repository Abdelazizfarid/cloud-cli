import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import type {
  SyncPayload,
  SyncProject,
  SyncSession,
  SyncConfig,
  SyncSkill,
  SyncConflict,
  SyncStatusResponse,
} from './sync.types.js';

const SYNC_META_FILE = path.join(os.homedir(), '.claude', '.cloud-cli-sync.json');

function getInstanceId(): string {
  try {
    if (fs.existsSync(SYNC_META_FILE)) {
      const meta = JSON.parse(fs.readFileSync(SYNC_META_FILE, 'utf-8'));
      if (meta.instanceId) return meta.instanceId;
    }
  } catch { /* ignore */ }
  const id = randomUUID();
  saveSyncMeta({ instanceId: id, lastSyncTimestamp: null });
  return id;
}

function getSyncMeta(): { instanceId: string; lastSyncTimestamp: string | null } {
  try {
    if (fs.existsSync(SYNC_META_FILE)) {
      return JSON.parse(fs.readFileSync(SYNC_META_FILE, 'utf-8'));
    }
  } catch { /* ignore */ }
  const id = randomUUID();
  const meta = { instanceId: id, lastSyncTimestamp: null };
  saveSyncMeta(meta);
  return meta;
}

function saveSyncMeta(meta: { instanceId: string; lastSyncTimestamp: string | null }): void {
  const dir = path.dirname(SYNC_META_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SYNC_META_FILE, JSON.stringify(meta, null, 2));
}

function getClaudeDir(): string {
  return path.join(os.homedir(), '.claude');
}

function readFileOrNull(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export function getLocalProjects(): SyncProject[] {
  const rows = projectsDb.getProjectPaths();
  return rows.map((r) => ({
    projectId: r.project_id,
    projectPath: r.project_path,
    displayName: r.custom_project_name || path.basename(r.project_path),
    isStarred: r.isStarred,
  }));
}

export function getLocalSessions(): SyncSession[] {
  const allSessions = sessionsDb.getAllSessions();
  return allSessions.map((s: any) => {
    let messages: string | null = null;
    if (s.jsonl_path && fs.existsSync(s.jsonl_path)) {
      messages = readFileOrNull(s.jsonl_path);
    }
    return {
      sessionId: s.session_id,
      provider: s.provider,
      projectPath: s.project_path || '',
      customName: s.custom_name,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
      messages,
    };
  });
}

export function getLocalConfigs(): SyncConfig[] {
  const projects = projectsDb.getProjectPaths();
  const configs: SyncConfig[] = [];

  for (const proj of projects) {
    const claudeMdPath = path.join(proj.project_path, 'CLAUDE.md');
    const claudeMd = readFileOrNull(claudeMdPath);
    if (claudeMd) {
      configs.push({ projectPath: proj.project_path, claudeMd, settings: null });
    }
  }

  // Global CLAUDE.md
  const globalClaudeMd = readFileOrNull(path.join(getClaudeDir(), 'CLAUDE.md'));
  if (globalClaudeMd) {
    configs.push({ projectPath: '__global__', claudeMd: globalClaudeMd, settings: null });
  }

  // Global settings
  const settingsPath = path.join(getClaudeDir(), 'settings.json');
  const settingsContent = readFileOrNull(settingsPath);
  if (settingsContent) {
    try {
      configs.push({ projectPath: '__settings__', claudeMd: null, settings: JSON.parse(settingsContent) });
    } catch { /* ignore malformed */ }
  }

  return configs;
}

export function getLocalSkills(): SyncSkill[] {
  const skillsDir = path.join(getClaudeDir(), 'skills');
  if (!fs.existsSync(skillsDir)) return [];

  const skills: SyncSkill[] = [];
  const entries = fs.readdirSync(skillsDir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.txt'))) {
      const fullPath = path.join(entry.parentPath || (entry as any).path || skillsDir, entry.name);
      const relativeName = path.relative(skillsDir, fullPath).replace(/\\/g, '/');
      const content = readFileOrNull(fullPath);
      if (content) {
        skills.push({ name: relativeName, content });
      }
    }
  }
  return skills;
}

export function buildLocalPayload(): SyncPayload {
  const meta = getSyncMeta();
  return {
    timestamp: new Date().toISOString(),
    instanceId: meta.instanceId,
    projects: getLocalProjects(),
    sessions: getLocalSessions(),
    configs: getLocalConfigs(),
    skills: getLocalSkills(),
  };
}

export function getSyncStatus(): SyncStatusResponse {
  const meta = getSyncMeta();
  const projects = projectsDb.getProjectPaths();
  const sessions = sessionsDb.getAllSessions();
  return {
    lastSyncTimestamp: meta.lastSyncTimestamp,
    localProjectCount: projects.length,
    localSessionCount: sessions.length,
    pendingChanges: 0,
  };
}

export function applyIncomingPayload(payload: SyncPayload): { accepted: number; conflicts: SyncConflict[] } {
  const conflicts: SyncConflict[] = [];
  let accepted = 0;

  // Apply projects
  for (const proj of payload.projects) {
    projectsDb.createProjectPath(proj.projectPath, proj.displayName);
    accepted++;
  }

  // Apply sessions - detect conflicts by updatedAt
  for (const session of payload.sessions) {
    const existing = sessionsDb.getSessionById(session.sessionId);
    if (existing && existing.updated_at && session.updatedAt) {
      const localTime = new Date(existing.updated_at).getTime();
      const remoteTime = new Date(session.updatedAt).getTime();
      if (localTime > remoteTime) {
        conflicts.push({
          type: 'session',
          key: session.sessionId,
          localValue: existing.updated_at,
          remoteValue: session.updatedAt,
          localUpdatedAt: existing.updated_at,
          remoteUpdatedAt: session.updatedAt,
        });
        continue;
      }
    }

    sessionsDb.createSession(
      session.sessionId,
      session.provider,
      session.projectPath,
      session.customName || undefined,
      session.createdAt,
      session.updatedAt,
      null
    );

    // Write JSONL messages if provided
    if (session.messages && session.projectPath) {
      const claudeDir = getClaudeDir();
      const projectDir = path.join(claudeDir, 'projects', path.basename(session.projectPath));
      if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });
      const jsonlPath = path.join(projectDir, `${session.sessionId}.jsonl`);
      fs.writeFileSync(jsonlPath, session.messages);
    }
    accepted++;
  }

  // Apply configs
  for (const config of payload.configs) {
    if (config.claudeMd) {
      if (config.projectPath === '__global__') {
        const target = path.join(getClaudeDir(), 'CLAUDE.md');
        const existing = readFileOrNull(target);
        if (existing && existing !== config.claudeMd) {
          conflicts.push({
            type: 'config',
            key: config.projectPath,
            localValue: existing,
            remoteValue: config.claudeMd,
            localUpdatedAt: new Date().toISOString(),
            remoteUpdatedAt: payload.timestamp,
          });
          continue;
        }
        fs.writeFileSync(target, config.claudeMd);
      } else if (config.projectPath !== '__settings__') {
        const target = path.join(config.projectPath, 'CLAUDE.md');
        const existing = readFileOrNull(target);
        if (existing && existing !== config.claudeMd) {
          conflicts.push({
            type: 'config',
            key: config.projectPath,
            localValue: existing,
            remoteValue: config.claudeMd,
            localUpdatedAt: new Date().toISOString(),
            remoteUpdatedAt: payload.timestamp,
          });
          continue;
        }
        const dir = path.dirname(target);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(target, config.claudeMd);
      }
    }

    if (config.settings && config.projectPath === '__settings__') {
      const target = path.join(getClaudeDir(), 'settings.json');
      const dir = path.dirname(target);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(target, JSON.stringify(config.settings, null, 2));
    }
    accepted++;
  }

  // Apply skills
  for (const skill of payload.skills) {
    const skillsDir = path.join(getClaudeDir(), 'skills');
    const target = path.join(skillsDir, skill.name);
    const existing = readFileOrNull(target);
    if (existing && existing !== skill.content) {
      conflicts.push({
        type: 'skill',
        key: skill.name,
        localValue: existing,
        remoteValue: skill.content,
        localUpdatedAt: new Date().toISOString(),
        remoteUpdatedAt: payload.timestamp,
      });
      continue;
    }
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(target, skill.content);
    accepted++;
  }

  // Update sync meta
  const meta = getSyncMeta();
  meta.lastSyncTimestamp = new Date().toISOString();
  saveSyncMeta(meta);

  return { accepted, conflicts };
}

export function resolveConflicts(
  resolutions: Array<{ type: string; key: string; choice: 'keep_local' | 'keep_remote' }>,
  remotePayload: SyncPayload
): number {
  let resolved = 0;

  for (const resolution of resolutions) {
    if (resolution.choice === 'keep_local') {
      resolved++;
      continue;
    }

    // keep_remote: apply the remote data
    if (resolution.type === 'session') {
      const session = remotePayload.sessions.find((s) => s.sessionId === resolution.key);
      if (session) {
        sessionsDb.createSession(
          session.sessionId,
          session.provider,
          session.projectPath,
          session.customName || undefined,
          session.createdAt,
          session.updatedAt,
          null
        );
        if (session.messages && session.projectPath) {
          const claudeDir = getClaudeDir();
          const projectDir = path.join(claudeDir, 'projects', path.basename(session.projectPath));
          if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });
          fs.writeFileSync(path.join(projectDir, `${session.sessionId}.jsonl`), session.messages);
        }
        resolved++;
      }
    } else if (resolution.type === 'config') {
      const config = remotePayload.configs.find((c) => c.projectPath === resolution.key);
      if (config?.claudeMd) {
        const target = config.projectPath === '__global__'
          ? path.join(getClaudeDir(), 'CLAUDE.md')
          : path.join(config.projectPath, 'CLAUDE.md');
        fs.writeFileSync(target, config.claudeMd);
        resolved++;
      }
    } else if (resolution.type === 'skill') {
      const skill = remotePayload.skills.find((s) => s.name === resolution.key);
      if (skill) {
        const target = path.join(getClaudeDir(), 'skills', skill.name);
        const dir = path.dirname(target);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(target, skill.content);
        resolved++;
      }
    }
  }

  return resolved;
}
