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
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Sync</h2>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setShowSettings(!showSettings)} className="p-1.5 rounded-md hover:bg-muted" aria-label="Settings">
              <Settings2 className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {showSettings && (
          <div className="mb-4 p-3 rounded-lg bg-muted/50 space-y-2">
            <label className="block text-sm font-medium">Remote Server URL</label>
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="http://187.127.234.30:3001"
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
            />
            <label className="block text-sm font-medium">Auth Token (optional)</label>
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="Bearer token for remote"
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
            />
            <button onClick={saveSettings} className="mt-2 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium">
              Save
            </button>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/30 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-destructive">{error}</p>
              <button onClick={dismissError} className="text-xs underline mt-1">Dismiss</button>
            </div>
          </div>
        )}

        {lastSync && (
          <p className="text-xs text-muted-foreground mb-4">
            Last synced: {new Date(lastSync).toLocaleString()}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={push}
            disabled={syncState !== 'idle' || !remoteUrl}
            className="flex flex-col items-center gap-2 p-4 rounded-lg border border-border hover:bg-muted/50 disabled:opacity-50 transition-colors"
          >
            {syncState === 'pushing' ? (
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            ) : (
              <CloudUpload className="w-6 h-6 text-blue-500" />
            )}
            <span className="text-sm font-medium">Push to Server</span>
            <span className="text-xs text-muted-foreground">Upload local data</span>
          </button>

          <button
            onClick={pull}
            disabled={syncState !== 'idle' || !remoteUrl}
            className="flex flex-col items-center gap-2 p-4 rounded-lg border border-border hover:bg-muted/50 disabled:opacity-50 transition-colors"
          >
            {syncState === 'pulling' ? (
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            ) : (
              <CloudDownload className="w-6 h-6 text-green-500" />
            )}
            <span className="text-sm font-medium">Pull from Server</span>
            <span className="text-xs text-muted-foreground">Download server data</span>
          </button>
        </div>

        {syncState === 'idle' && !error && lastSync && (
          <div className="mt-4 flex items-center gap-2 text-sm text-green-600">
            <Check className="w-4 h-4" />
            <span>In sync</span>
          </div>
        )}
      </div>
    </div>
  );
}
