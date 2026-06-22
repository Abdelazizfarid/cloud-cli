import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import Sidebar from '../sidebar/view/Sidebar';
import MainContent from '../main-content/view/MainContent';
import CommandPalette from '../command-palette/CommandPalette';
import TabBar from '../tab-bar/TabBar';
import NewTabPicker from '../tab-bar/NewTabPicker';
import Dashboard from '../dashboard/Dashboard';
import SplitView from '../split-view/SplitView';
import SyncPanel from '../sync/SyncPanel';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { PaletteOpsProvider, usePaletteOpsRegister } from '../../contexts/PaletteOpsContext';
import { useDeviceSettings } from '../../hooks/useDeviceSettings';
import { useSessionProtection } from '../../hooks/useSessionProtection';
import { useProjectsState } from '../../hooks/useProjectsState';
import { useTabsState } from '../../hooks/useTabsState';
import { useUiPreferences } from '../../hooks/useUiPreferences';
import { api } from '../../utils/api';

const DEFAULT_AGENT_CONTROL_PLANE_URL = 'https://agents.hooktrack.life/sessions/';
const DEFAULT_AGENT_CONTROL_PLANE_PATH = '/sessions/';

export default function AppContent() {
  return (
    <PaletteOpsProvider>
      <AppContentInner />
    </PaletteOpsProvider>
  );
}

function AppContentInner() {
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionId } = useParams<{ sessionId?: string }>();
  const isHomeRoute = location.pathname === '/home' || location.pathname === '/home/';
  const { t } = useTranslation('common');
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const { preferences } = useUiPreferences();
  const sidebarCollapsed = !isMobile && !preferences.sidebarVisible;
  const { ws, sendMessage, latestMessage, isConnected } = useWebSocket();
  const wasConnectedRef = useRef(false);

  const {
    activeSessions,
    processingSessions,
    markSessionAsActive,
    markSessionAsInactive,
    markSessionAsProcessing,
    markSessionAsNotProcessing,
  } = useSessionProtection();

  const {
    projects,
    selectedProject,
    selectedSession,
    activeTab,
    sidebarOpen,
    isLoadingProjects,
    externalMessageUpdate,
    newSessionTrigger,
    setActiveTab,
    setSidebarOpen,
    setIsInputFocused,
    setShowSettings,
    openSettings,
    refreshProjectsSilently,
    sidebarSharedProps,
    handleNewSession,
    handleProjectSelect,
    handleSessionSelect,
    handleProjectDelete,
  } = useProjectsState({
    sessionId,
    navigate,
    latestMessage,
    isMobile,
    activeSessions,
  });

  const {
    tabs,
    activeTab: activeSessionTab,
    activeTabId,
    addTab,
    closeTab,
    switchTab,
    updateTabSession,
    updateTabProject,
  } = useTabsState();

  const [showNewTabPicker, setShowNewTabPicker] = useState(false);
  const [forceDashboard, setForceDashboard] = useState(false);
  const [splitMode, setSplitMode] = useState(false);
  const [showSyncPanel, setShowSyncPanel] = useState(false);
  const [showAgentControlPlane, setShowAgentControlPlane] = useState(false);
  const [agentControlPlaneCacheBust, setAgentControlPlaneCacheBust] = useState(() => Date.now());
  const agentControlPlaneUrl = useMemo(() => {
    const baseUrl = (import.meta.env.VITE_AGENT_CONTROL_PLANE_URL || DEFAULT_AGENT_CONTROL_PLANE_URL).trim();
    const token = (import.meta.env.VITE_AGENT_CONTROL_PLANE_TOKEN || '').trim();
    const fallbackOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';

    try {
      const parsedBase = new URL(baseUrl, fallbackOrigin);
      const normalizedPath = DEFAULT_AGENT_CONTROL_PLANE_PATH;
      const parsedUrl = new URL(normalizedPath, parsedBase.origin);
      if (token) {
        parsedUrl.searchParams.set('token', token);
      }
      parsedUrl.searchParams.set('cloudcli_embed', '1');
      parsedUrl.searchParams.set('cache_bust', String(agentControlPlaneCacheBust));
      return parsedUrl.toString();
    } catch {
      return baseUrl;
    }
  }, [agentControlPlaneCacheBust]);

  // Clear forceDashboard when navigating away from /home
  useEffect(() => {
    if (sessionId) {
      setForceDashboard(false);
    }
  }, [sessionId]);

  // Sync: when user switches session tab, select that tab's project/session
  const handleTabSwitch = useCallback((tabId: string) => {
    setForceDashboard(false);
    setSplitMode(false);
    setShowAgentControlPlane(false);
    switchTab(tabId);
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const project = projects.find((p) => p.projectId === tab.projectId);
    if (project) {
      handleProjectSelect(project);
      if (tab.sessionId) {
        const allSessions = [
          ...(project.sessions ?? []),
          ...(project.cursorSessions ?? []),
          ...(project.codexSessions ?? []),
          ...(project.geminiSessions ?? []),
          ...(project.opencodeSessions ?? []),
        ];
        const session = allSessions.find((s) => s.id === tab.sessionId);
        if (session) handleSessionSelect(session);
      }
    }
  }, [switchTab, tabs, projects, handleProjectSelect, handleSessionSelect]);

  const handleDashboardProjectDelete = useCallback(async (projectId: string, force: boolean) => {
    try {
      const response = await api.deleteProject(projectId, force);
      if (response.ok) {
        handleProjectDelete(projectId);
      }
    } catch (e) {
      console.error('Failed to delete project:', e);
    }
  }, [handleProjectDelete]);

  // Sync: when user selects a session from sidebar, update active tab
  useEffect(() => {
    if (splitMode) return;
    if (!activeSessionTab || !selectedSession) return;
    if (activeSessionTab.sessionId !== selectedSession.id) {
      updateTabSession(activeSessionTab.id, selectedSession);
    }
  }, [selectedSession, activeSessionTab, updateTabSession, splitMode]);

  // Sync: when user selects a project from sidebar, update active tab
  useEffect(() => {
    if (splitMode) return;
    if (!activeSessionTab || !selectedProject) return;
    if (activeSessionTab.projectId !== selectedProject.projectId) {
      updateTabProject(activeSessionTab.id, selectedProject);
    }
  }, [selectedProject, activeSessionTab, updateTabProject, splitMode]);

  // Auto-create first tab if none exist and a project is loaded
  useEffect(() => {
    if (tabs.length === 0 && selectedProject) {
      addTab(selectedProject, selectedSession);
    }
  }, [tabs.length, selectedProject, selectedSession, addTab]);

  usePaletteOpsRegister({
    openSettings,
    refreshProjects: refreshProjectsSilently,
  });

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return undefined;
    }

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      const message = event.data;
      if (!message || message.type !== 'notification:navigate') {
        return;
      }

      if (typeof message.provider === 'string' && message.provider.trim()) {
        localStorage.setItem('selected-provider', message.provider);
      }

      setActiveTab('chat');
      setSidebarOpen(false);
      void refreshProjectsSilently();

      if (typeof message.sessionId === 'string' && message.sessionId) {
        navigate(`/session/${message.sessionId}`);
        return;
      }

      navigate('/');
    };

    navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
    };
  }, [navigate, refreshProjectsSilently, setActiveTab, setSidebarOpen]);

  const openAgentControlPlane = useCallback(() => {
    setForceDashboard(false);
    setSplitMode(false);
    setAgentControlPlaneCacheBust(Date.now());
    setShowAgentControlPlane(true);
    setSidebarOpen(false);
  }, [setSidebarOpen]);

  // Refresh projects when active sessions change (new session created)
  useEffect(() => {
    if (activeSessions.size > 0) {
      const timer = setTimeout(() => void refreshProjectsSilently(), 1000);
      return () => clearTimeout(timer);
    }
  }, [activeSessions.size, refreshProjectsSilently]);

  // Permission recovery: query pending permissions on WebSocket reconnect or session change
  useEffect(() => {
    const isReconnect = isConnected && !wasConnectedRef.current;

    if (isReconnect) {
      wasConnectedRef.current = true;
    } else if (!isConnected) {
      wasConnectedRef.current = false;
    }

    if (isConnected && selectedSession?.id) {
      sendMessage({
        type: 'get-pending-permissions',
        sessionId: selectedSession.id
      });
    }
  }, [isConnected, selectedSession?.id, sendMessage]);

  // Adjust the app container to stay above the virtual keyboard on iOS Safari.
  // On Chrome for Android the layout viewport already shrinks when the keyboard opens,
  // so inset-0 adjusts automatically. On iOS the layout viewport stays full-height and
  // the keyboard overlays it — we use the Visual Viewport API to track keyboard height
  // and apply it as a CSS variable that shifts the container's bottom edge up.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      // Only resize matters — keyboard open/close changes vv.height.
      // Do NOT listen to scroll: on iOS Safari, scrolling content changes
      // vv.offsetTop which would make --keyboard-height fluctuate during
      // normal scrolling, causing the container to bounce up and down.
      const kb = Math.max(0, window.innerHeight - vv.height);
      document.documentElement.style.setProperty('--keyboard-height', `${kb}px`);
    };
    vv.addEventListener('resize', update);
    return () => vv.removeEventListener('resize', update);
  }, []);

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('sidebar-width');
    return saved ? parseInt(saved, 10) : 260;
  });
  const isResizing = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = Math.min(Math.max(ev.clientX, 180), 500);
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('sidebar-width', String(sidebarWidth));
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [sidebarWidth]);

  return (
    <div className="fixed inset-0 flex bg-background" style={{ bottom: 'var(--keyboard-height, 0px)' }}>
      {!isMobile ? (
        <>
          <div
            className="h-full flex-shrink-0 border-r border-border/50 transition-[width] duration-150"
            style={{ width: sidebarCollapsed ? 'auto' : sidebarWidth }}
          >
            <Sidebar
              {...sidebarSharedProps}
              onOpenAgentControlPlane={openAgentControlPlane}
            />
          </div>
          {!sidebarCollapsed && (
            <div
              onMouseDown={handleMouseDown}
              className="relative z-10 h-full w-1 flex-shrink-0 cursor-col-resize group"
            >
              <div className="absolute inset-y-0 -left-0.5 w-2 group-hover:bg-primary/20 group-active:bg-primary/30 transition-colors duration-150" />
            </div>
          )}
        </>
      ) : (
        <div
          className={`fixed inset-0 z-50 flex transition-all duration-150 ease-out ${sidebarOpen ? 'visible opacity-100' : 'invisible opacity-0'
            }`}
        >
          <button
            className="fixed inset-0 bg-background/60 backdrop-blur-sm transition-opacity duration-150 ease-out"
            onClick={(event) => {
              event.stopPropagation();
              setSidebarOpen(false);
            }}
            onTouchStart={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setSidebarOpen(false);
            }}
            aria-label={t('versionUpdate.ariaLabels.closeSidebar')}
          />
          <div
            className={`relative h-full w-[85vw] max-w-sm transform border-r border-border/40 bg-card transition-transform duration-150 ease-out sm:w-80 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'
              }`}
            onClick={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
          >
            <Sidebar
              {...sidebarSharedProps}
              onOpenAgentControlPlane={openAgentControlPlane}
            />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {!isMobile && (
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            showingDashboard={forceDashboard || isHomeRoute || (!selectedSession && !isLoadingProjects && activeTab !== 'chat' && projects.length > 0)}
            splitMode={splitMode}
            onSwitch={handleTabSwitch}
            onClose={closeTab}
            onAdd={() => setShowNewTabPicker(true)}
            onHome={() => { setForceDashboard(true); setSplitMode(false); navigate('/home'); }}
            onToggleSplit={() => { setSplitMode((prev) => !prev); setForceDashboard(false); }}
          />
        )}
        <div className="relative flex-1 min-h-0">
          {showNewTabPicker && (
            <NewTabPicker
              projects={projects}
              onSelect={(project, session) => {
                addTab(project, session);
                handleProjectSelect(project);
                if (session) handleSessionSelect(session);
                setShowNewTabPicker(false);
              }}
              onCancel={() => setShowNewTabPicker(false)}
            />
          )}
          {showAgentControlPlane ? (
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
              <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                <h2 className="text-sm font-semibold text-foreground">Agent Control Plane</h2>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setAgentControlPlaneCacheBust(Date.now())}
                    className="rounded-md border border-border/60 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    Refresh ACP
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAgentControlPlane(false)}
                    className="rounded-md border border-border/60 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    Back to CloudCLI
                  </button>
                </div>
              </div>
              <iframe
                key={String(agentControlPlaneCacheBust)}
                title="Agent Control Plane"
                src={agentControlPlaneUrl}
                className="h-full w-full border-0"
              />
            </div>
          ) : (forceDashboard || isHomeRoute || (!selectedSession && !isLoadingProjects && activeTab !== 'chat')) && projects.length > 0 && !splitMode ? (
              <Dashboard
                projects={projects}
                activeSessions={activeSessions}
                processingSessions={processingSessions}
                onProjectSelect={(project) => { setForceDashboard(false); handleProjectSelect(project); }}
                onSessionSelect={(session) => { setForceDashboard(false); handleSessionSelect(session); }}
                onNewSession={(project) => { setForceDashboard(false); handleNewSession(project); }}
                onProjectDelete={handleDashboardProjectDelete}
                onProjectArchive={async (projectId) => {
                  try {
                    const res = await api.archiveProject(projectId);
                    if (res.ok) handleProjectDelete(projectId);
                  } catch (e) { console.error('Archive failed:', e); }
                }}
              />
            ) : splitMode && tabs.length > 1 ? (
              <SplitView
                tabs={tabs}
                activeTabId={activeTabId}
                projects={projects}
                ws={ws}
                sendMessage={sendMessage}
                latestMessage={latestMessage}
                processingSessions={processingSessions}
                onFocusTab={switchTab}
                onSessionActive={markSessionAsActive}
                onSessionInactive={markSessionAsInactive}
                onSessionProcessing={markSessionAsProcessing}
                onSessionNotProcessing={markSessionAsNotProcessing}
              />
            ) : (
              <MainContent
                selectedProject={selectedProject}
                selectedSession={selectedSession}
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                ws={ws}
                sendMessage={sendMessage}
                latestMessage={latestMessage}
                isMobile={isMobile}
                onMenuClick={() => setSidebarOpen(true)}
                isLoading={isLoadingProjects}
                onInputFocusChange={setIsInputFocused}
                onSessionActive={markSessionAsActive}
                onSessionInactive={markSessionAsInactive}
                onSessionProcessing={markSessionAsProcessing}
                onSessionNotProcessing={markSessionAsNotProcessing}
                processingSessions={processingSessions}
                onNavigateToSession={(targetSessionId: string, options) =>
                  navigate(`/session/${targetSessionId}`, { replace: Boolean(options?.replace) })
                }
                onShowSettings={() => setShowSettings(true)}
                externalMessageUpdate={externalMessageUpdate}
                newSessionTrigger={newSessionTrigger}
              />
            )}
        </div>
      </div>

      <CommandPalette
        selectedProject={selectedProject}
        onStartNewChat={handleNewSession}
        onOpenSettings={() => openSettings()}
        onShowTab={setActiveTab}
      />

      {showSyncPanel && <SyncPanel onClose={() => setShowSyncPanel(false)} />}
    </div>
  );
}
