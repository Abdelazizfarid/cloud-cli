export interface SyncProject {
  projectId: string;
  projectPath: string;
  displayName: string;
  isStarred: number;
}

export interface SyncSession {
  sessionId: string;
  provider: string;
  projectPath: string;
  customName: string | null;
  createdAt: string;
  updatedAt: string;
  messages: string | null; // JSONL content
}

export interface SyncConfig {
  projectPath: string;
  claudeMd: string | null;
  settings: Record<string, unknown> | null;
}

export interface SyncSkill {
  name: string;
  content: string;
}

export interface SyncPayload {
  timestamp: string;
  instanceId: string;
  projects: SyncProject[];
  sessions: SyncSession[];
  configs: SyncConfig[];
  skills: SyncSkill[];
}

export interface SyncConflict {
  type: 'session' | 'config' | 'skill';
  key: string;
  localValue: string;
  remoteValue: string;
  localUpdatedAt: string;
  remoteUpdatedAt: string;
}

export interface SyncStatusResponse {
  lastSyncTimestamp: string | null;
  localProjectCount: number;
  localSessionCount: number;
  pendingChanges: number;
}

export interface SyncPullResponse {
  payload: SyncPayload;
}

export interface SyncPushResponse {
  accepted: number;
  conflicts: SyncConflict[];
}

export interface SyncResolveRequest {
  resolutions: Array<{
    type: 'session' | 'config' | 'skill';
    key: string;
    choice: 'keep_local' | 'keep_remote';
  }>;
}
