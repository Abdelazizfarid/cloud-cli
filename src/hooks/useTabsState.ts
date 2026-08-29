import { useCallback, useEffect, useState } from 'react';
import type { Project, ProjectSession } from '../types/app';

export interface AppSessionTab {
  id: string;
  projectId: string;
  sessionId: string | null;
  title: string;
}

const STORAGE_KEY = 'app-session-tabs';
const ACTIVE_TAB_KEY = 'app-active-tab-id';

function generateTabId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadTabs(): AppSessionTab[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppSessionTab[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch { /* ignore */ }
  return [];
}

function loadActiveTabId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_TAB_KEY);
  } catch { /* ignore */ }
  return null;
}

function persistTabs(tabs: AppSessionTab[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
  } catch { /* ignore */ }
}

function persistActiveTabId(id: string) {
  try {
    localStorage.setItem(ACTIVE_TAB_KEY, id);
  } catch { /* ignore */ }
}

export function useTabsState() {
  const [tabs, setTabs] = useState<AppSessionTab[]>(loadTabs);
  const [activeTabId, setActiveTabId] = useState<string | null>(loadActiveTabId);

  useEffect(() => { persistTabs(tabs); }, [tabs]);
  useEffect(() => { if (activeTabId) persistActiveTabId(activeTabId); }, [activeTabId]);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0] ?? null;

  const addTab = useCallback((project: Project, session: ProjectSession | null) => {
    const newTab: AppSessionTab = {
      id: generateTabId(),
      projectId: project.projectId,
      sessionId: session?.id ?? null,
      title: session?.title || session?.summary || project.displayName,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
    return newTab;
  }, []);

  const closeTab = useCallback((tabId: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === tabId);
      const next = prev.filter((t) => t.id !== tabId);
      if (next.length === 0) return next;
      setActiveTabId((currentActive) => {
        if (currentActive === tabId) {
          const newIdx = Math.min(idx, next.length - 1);
          return next[newIdx]?.id ?? null;
        }
        return currentActive;
      });
      return next;
    });
  }, []);

  const switchTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
  }, []);

  const updateTabSession = useCallback((tabId: string, session: ProjectSession | null, title?: string) => {
    setTabs((prev) => prev.map((t) => {
      if (t.id !== tabId) return t;
      return {
        ...t,
        sessionId: session?.id ?? null,
        title: title || session?.title || session?.summary || t.title,
      };
    }));
  }, []);

  const updateTabProject = useCallback((tabId: string, project: Project) => {
    setTabs((prev) => prev.map((t) => {
      if (t.id !== tabId) return t;
      return { ...t, projectId: project.projectId, sessionId: null, title: project.displayName };
    }));
  }, []);

  return {
    tabs,
    activeTab,
    activeTabId,
    addTab,
    closeTab,
    switchTab,
    updateTabSession,
    updateTabProject,
    setTabs,
  };
}
