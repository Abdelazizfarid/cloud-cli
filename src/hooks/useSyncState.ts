import { useState, useCallback } from 'react';
import { authenticatedFetch } from '../utils/api';

export interface SyncConflict {
  type: 'session' | 'config' | 'skill';
  key: string;
  localValue: string;
  remoteValue: string;
  localUpdatedAt: string;
  remoteUpdatedAt: string;
}

export interface SyncStatus {
  lastSyncTimestamp: string | null;
  localProjectCount: number;
  localSessionCount: number;
  pendingChanges: number;
}

type SyncState = 'idle' | 'pushing' | 'pulling' | 'resolving' | 'error';

export function useSyncState() {
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [lastSync, setLastSync] = useState<string | null>(
    localStorage.getItem('sync-last-timestamp')
  );
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [remotePayload, setRemotePayload] = useState<any>(null);

  const remoteUrl = localStorage.getItem('sync-remote-url') || '';

  const getRemoteBase = useCallback(() => {
    const url = localStorage.getItem('sync-remote-url');
    if (!url) throw new Error('No remote sync URL configured');
    return url.replace(/\/$/, '');
  }, []);

  const push = useCallback(async () => {
    setSyncState('pushing');
    setError(null);
    try {
      // Pull local payload from our own server
      const localRes = await authenticatedFetch('/api/sync/pull');
      if (!localRes.ok) throw new Error('Failed to get local data');
      const { payload } = await localRes.json();

      // Push to remote
      const remoteBase = getRemoteBase();
      const remoteToken = localStorage.getItem('sync-remote-token') || localStorage.getItem('auth-token');
      const pushRes = await fetch(`${remoteBase}/api/sync/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${remoteToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!pushRes.ok) throw new Error(`Remote push failed: ${pushRes.statusText}`);
      const result = await pushRes.json();

      if (result.conflicts && result.conflicts.length > 0) {
        setConflicts(result.conflicts);
        setRemotePayload(payload);
        setSyncState('resolving');
      } else {
        const now = new Date().toISOString();
        setLastSync(now);
        localStorage.setItem('sync-last-timestamp', now);
        setSyncState('idle');
      }
    } catch (err: any) {
      setError(err.message);
      setSyncState('error');
    }
  }, [getRemoteBase]);

  const pull = useCallback(async () => {
    setSyncState('pulling');
    setError(null);
    try {
      const remoteBase = getRemoteBase();
      const remoteToken = localStorage.getItem('sync-remote-token') || localStorage.getItem('auth-token');

      // Pull from remote
      const pullRes = await fetch(`${remoteBase}/api/sync/pull`, {
        headers: { 'Authorization': `Bearer ${remoteToken}` },
      });
      if (!pullRes.ok) throw new Error(`Remote pull failed: ${pullRes.statusText}`);
      const { payload } = await pullRes.json();

      // Push to local
      const localRes = await authenticatedFetch('/api/sync/push', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (!localRes.ok) throw new Error('Failed to apply remote data locally');
      const result = await localRes.json();

      if (result.conflicts && result.conflicts.length > 0) {
        setConflicts(result.conflicts);
        setRemotePayload(payload);
        setSyncState('resolving');
      } else {
        const now = new Date().toISOString();
        setLastSync(now);
        localStorage.setItem('sync-last-timestamp', now);
        setSyncState('idle');
      }
    } catch (err: any) {
      setError(err.message);
      setSyncState('error');
    }
  }, [getRemoteBase]);

  const resolveConflict = useCallback(async (
    resolutions: Array<{ type: string; key: string; choice: 'keep_local' | 'keep_remote' }>
  ) => {
    try {
      const res = await authenticatedFetch('/api/sync/resolve', {
        method: 'POST',
        body: JSON.stringify({ resolutions, remotePayload }),
      });
      if (!res.ok) throw new Error('Failed to resolve conflicts');
      setConflicts([]);
      setRemotePayload(null);
      const now = new Date().toISOString();
      setLastSync(now);
      localStorage.setItem('sync-last-timestamp', now);
      setSyncState('idle');
    } catch (err: any) {
      setError(err.message);
      setSyncState('error');
    }
  }, [remotePayload]);

  const dismissError = useCallback(() => {
    setError(null);
    setSyncState('idle');
  }, []);

  return {
    syncState,
    lastSync,
    conflicts,
    error,
    remoteUrl,
    push,
    pull,
    resolveConflict,
    dismissError,
  };
}
