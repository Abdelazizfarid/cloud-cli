import { useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, X } from 'lucide-react';

import type { SyncConflict } from '../../hooks/useSyncState';

interface Props {
  conflicts: SyncConflict[];
  onResolve: (resolutions: Array<{ type: string; key: string; choice: 'keep_local' | 'keep_remote' }>) => void;
  onClose: () => void;
}

export default function ConflictResolver({ conflicts, onResolve, onClose }: Props) {
  const [resolutions, setResolutions] = useState<Record<string, 'keep_local' | 'keep_remote'>>({});

  const setChoice = (key: string, choice: 'keep_local' | 'keep_remote') => {
    setResolutions((prev) => ({ ...prev, [key]: choice }));
  };

  const allResolved = conflicts.every((c) => resolutions[c.key]);

  const handleSubmit = () => {
    const resolved = conflicts.map((c) => ({
      type: c.type,
      key: c.key,
      choice: resolutions[c.key] || 'keep_local',
    }));
    onResolve(resolved);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <h2 className="text-lg font-semibold">Resolve Conflicts ({conflicts.length})</h2>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 hover:bg-muted" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {conflicts.map((conflict) => (
            <div key={conflict.key} className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium capitalize">{conflict.type}: {conflict.key}</span>
                <span className="text-xs text-muted-foreground">
                  Local: {new Date(conflict.localUpdatedAt).toLocaleString()}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setChoice(conflict.key, 'keep_local')}
                  className={`flex items-center gap-1 rounded-md border p-2 text-sm transition-colors ${
                    resolutions[conflict.key] === 'keep_local'
                      ? 'border-blue-500 bg-blue-500/10 text-blue-600'
                      : 'border-border hover:bg-muted/50'
                  }`}
                >
                  <ArrowLeft className="h-3 w-3" />
                  Keep Local
                </button>
                <button
                  onClick={() => setChoice(conflict.key, 'keep_remote')}
                  className={`flex items-center gap-1 rounded-md border p-2 text-sm transition-colors ${
                    resolutions[conflict.key] === 'keep_remote'
                      ? 'border-green-500 bg-green-500/10 text-green-600'
                      : 'border-border hover:bg-muted/50'
                  }`}
                >
                  <ArrowRight className="h-3 w-3" />
                  Keep Remote
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-border p-4">
          <button
            onClick={handleSubmit}
            disabled={!allResolved}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50"
          >
            <Check className="h-4 w-4" />
            Apply Resolutions
          </button>
        </div>
      </div>
    </div>
  );
}
