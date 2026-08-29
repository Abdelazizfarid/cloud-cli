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
      <div className="w-full max-w-lg max-h-[80vh] rounded-xl border border-border bg-card shadow-2xl flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <h2 className="text-lg font-semibold">Resolve Conflicts ({conflicts.length})</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {conflicts.map((conflict) => (
            <div key={conflict.key} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium capitalize">{conflict.type}: {conflict.key}</span>
                <span className="text-xs text-muted-foreground">
                  Local: {new Date(conflict.localUpdatedAt).toLocaleString()}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setChoice(conflict.key, 'keep_local')}
                  className={`flex items-center gap-1 p-2 rounded-md border text-sm transition-colors ${
                    resolutions[conflict.key] === 'keep_local'
                      ? 'border-blue-500 bg-blue-500/10 text-blue-600'
                      : 'border-border hover:bg-muted/50'
                  }`}
                >
                  <ArrowLeft className="w-3 h-3" />
                  Keep Local
                </button>
                <button
                  onClick={() => setChoice(conflict.key, 'keep_remote')}
                  className={`flex items-center gap-1 p-2 rounded-md border text-sm transition-colors ${
                    resolutions[conflict.key] === 'keep_remote'
                      ? 'border-green-500 bg-green-500/10 text-green-600'
                      : 'border-border hover:bg-muted/50'
                  }`}
                >
                  <ArrowRight className="w-3 h-3" />
                  Keep Remote
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-border">
          <button
            onClick={handleSubmit}
            disabled={!allResolved}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground font-medium disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
            Apply Resolutions
          </button>
        </div>
      </div>
    </div>
  );
}
