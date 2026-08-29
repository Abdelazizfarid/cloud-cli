import { useState } from 'react';
import { Cloud, CloudUpload, CloudDownload, AlertCircle, Check, Loader2, Settings2, X } from 'lucide-react';

import { useSyncState } from '../../hooks/useSyncState';

import ConflictResolver from './ConflictResolver';

export default function SyncPanel({ onClose }: { onClose: () => void }) {
  const {
    syncState,
    lastSync,
    conflicts,
    error,
    remoteUrl,
    push,
    pull,
    resolveConflict,
    dismissError,
    refreshRemoteUrl,
  } = useSyncState();

  const [showSettings, setShowSettings] = useState(!remoteUrl);
  const [urlInput, setUrlInput] = useState(remoteUrl);
  const [tokenInput, setTokenInput] = useState(localStorage.getItem('sync-remote-token') || '');

  const saveSettings = () => {
    localStorage.setItem('sync-remote-url', urlInput);
    if (tokenInput) localStorage.setItem('sync-remote-token', tokenInput);
    setShowSettings(false);
    refreshRemoteUrl();
  };

  if (syncState === 'resolving' && conflicts.length > 0) {
    return <ConflictResolver conflicts={conflicts} onResolve={resolveConflict} onClose={onClose} />;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cloud className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Sync</h2>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setShowSettings(!showSettings)} className="rounded-md p-1.5 hover:bg-muted" aria-label="Settings">
              <Settings2 className="h-4 w-4" />
            </button>
            <button onClick={onClose} className="rounded-md p-1.5 hover:bg-muted" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {showSettings && (
          <div className="mb-4 space-y-2 rounded-lg bg-muted/50 p-3">
            <label className="block text-sm font-medium">Remote Server URL</label>
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="http://187.127.234.30:3001"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <label className="block text-sm font-medium">Auth Token (optional)</label>
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="Bearer token for remote"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <button onClick={saveSettings} className="mt-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
              Save
            </button>
          </div>
        )}

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="flex-1">
              <p className="text-sm text-destructive">{error}</p>
              <button onClick={dismissError} className="mt-1 text-xs underline">Dismiss</button>
            </div>
          </div>
        )}

        {lastSync && (
          <p className="mb-4 text-xs text-muted-foreground">
            Last synced: {new Date(lastSync).toLocaleString()}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={push}
            disabled={syncState !== 'idle' || !remoteUrl}
            className="flex flex-col items-center gap-2 rounded-lg border border-border p-4 transition-colors hover:bg-muted/50 disabled:opacity-50"
          >
            {syncState === 'pushing' ? (
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            ) : (
              <CloudUpload className="h-6 w-6 text-blue-500" />
            )}
            <span className="text-sm font-medium">Push to Server</span>
            <span className="text-xs text-muted-foreground">Upload local data</span>
          </button>

          <button
            onClick={pull}
            disabled={syncState !== 'idle' || !remoteUrl}
            className="flex flex-col items-center gap-2 rounded-lg border border-border p-4 transition-colors hover:bg-muted/50 disabled:opacity-50"
          >
            {syncState === 'pulling' ? (
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            ) : (
              <CloudDownload className="h-6 w-6 text-green-500" />
            )}
            <span className="text-sm font-medium">Pull from Server</span>
            <span className="text-xs text-muted-foreground">Download server data</span>
          </button>
        </div>

        {syncState === 'idle' && !error && lastSync && (
          <div className="mt-4 flex items-center gap-2 text-sm text-green-600">
            <Check className="h-4 w-4" />
            <span>In sync</span>
          </div>
        )}
      </div>
    </div>
  );
}
