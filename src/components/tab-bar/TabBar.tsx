import { Columns2, Home, Plus, X } from 'lucide-react';

import type { AppSessionTab } from '../../hooks/useTabsState';

interface TabBarProps {
  tabs: AppSessionTab[];
  activeTabId: string | null;
  showingDashboard: boolean;
  splitMode: boolean;
  onSwitch: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onAdd: () => void;
  onHome: () => void;
  onToggleSplit: () => void;
}

export default function TabBar({ tabs, activeTabId, showingDashboard, splitMode, onSwitch, onClose, onAdd, onHome, onToggleSplit }: TabBarProps) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-0 overflow-x-auto border-b border-border/50 bg-background/80 px-1 backdrop-blur-sm">
      <button
        onClick={onHome}
        className={`flex h-full w-8 shrink-0 items-center justify-center transition-colors ${
          showingDashboard
            ? 'border-b-2 border-primary bg-muted/40 text-primary'
            : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground'
        }`}
        aria-label="Dashboard"
      >
        <Home className="h-3.5 w-3.5" />
      </button>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId && !showingDashboard && !splitMode;
        return (
          <div
            key={tab.id}
            onClick={() => onSwitch(tab.id)}
            className={`
              group relative flex h-full max-w-[180px] cursor-pointer select-none items-center
              gap-1.5 px-3 text-xs font-medium transition-colors duration-100
              ${isActive
                ? 'border-b-2 border-primary bg-muted/40 text-foreground'
                : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground'
              }
            `}
          >
            <span className="truncate">{tab.title || 'New Tab'}</span>
            {tabs.length > 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                className="ml-auto rounded p-0.5 opacity-0 transition-opacity hover:bg-destructive/20 group-hover:opacity-100"
                aria-label="Close tab"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        );
      })}
      <button
        onClick={onAdd}
        className="ml-0.5 flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        aria-label="New tab"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      {tabs.length > 1 && (
        <button
          onClick={onToggleSplit}
          className={`ml-auto flex h-7 w-7 items-center justify-center rounded transition-colors ${
            splitMode
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
          }`}
          aria-label="Split view"
        >
          <Columns2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
