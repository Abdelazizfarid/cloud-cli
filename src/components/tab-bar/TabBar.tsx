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
    <div className="flex items-center gap-0 border-b border-border/50 bg-background/80 backdrop-blur-sm px-1 h-9 overflow-x-auto shrink-0">
      <button
        onClick={onHome}
        className={`flex items-center justify-center w-8 h-full shrink-0 transition-colors ${
          showingDashboard
            ? 'text-primary border-b-2 border-primary bg-muted/40'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
        }`}
        aria-label="Dashboard"
      >
        <Home className="w-3.5 h-3.5" />
      </button>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId && !showingDashboard && !splitMode;
        return (
          <div
            key={tab.id}
            onClick={() => onSwitch(tab.id)}
            className={`
              group relative flex items-center gap-1.5 px-3 h-full cursor-pointer
              text-xs font-medium select-none transition-colors duration-100 max-w-[180px]
              ${isActive
                ? 'text-foreground border-b-2 border-primary bg-muted/40'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
              }
            `}
          >
            <span className="truncate">{tab.title || 'New Tab'}</span>
            {tabs.length > 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                className="ml-auto opacity-0 group-hover:opacity-100 hover:bg-destructive/20 rounded p-0.5 transition-opacity"
                aria-label="Close tab"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        );
      })}
      <button
        onClick={onAdd}
        className="flex items-center justify-center w-7 h-7 ml-0.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="New tab"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
      {tabs.length > 1 && (
        <button
          onClick={onToggleSplit}
          className={`flex items-center justify-center w-7 h-7 ml-auto rounded transition-colors ${
            splitMode
              ? 'text-primary bg-primary/10'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          }`}
          aria-label="Split view"
        >
          <Columns2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
