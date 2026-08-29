import { useMemo } from 'react';
import { Folder, MessageSquare } from 'lucide-react';
import ChatInterface from '../chat/view/ChatInterface';
import type { AppSessionTab } from '../../hooks/useTabsState';
import type { Project, ProjectSession } from '../../types/app';

interface SplitViewProps {
  tabs: AppSessionTab[];
  activeTabId: string | null;
  projects: Project[];
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  latestMessage: unknown;
  processingSessions: Map<string, number>;
  onFocusTab: (tabId: string) => void;
  onSessionActive: (sessionId?: string | null) => void;
  onSessionInactive: (sessionId?: string | null) => void;
  onSessionProcessing: (sessionId?: string | null) => void;
  onSessionNotProcessing: (sessionId?: string | null) => void;
}

function resolveTabContext(tab: AppSessionTab, projects: Project[]): { project: Project | null; session: ProjectSession | null } {
  const project = projects.find((p) => p.projectId === tab.projectId) ?? null;
  if (!project || !tab.sessionId) return { project, session: null };
  const allSessions = [
    ...(project.sessions ?? []),
    ...(project.cursorSessions ?? []),
    ...(project.codexSessions ?? []),
    ...(project.geminiSessions ?? []),
    ...(project.opencodeSessions ?? []),
  ];
  const session = allSessions.find((s) => s.id === tab.sessionId) ?? null;
  return { project, session };
}

export default function SplitView({
  tabs,
  activeTabId,
  projects,
  ws,
  sendMessage,
  latestMessage,
  processingSessions,
  onFocusTab,
  onSessionActive,
  onSessionInactive,
  onSessionProcessing,
  onSessionNotProcessing,
}: SplitViewProps) {
  const cols = tabs.length <= 2 ? tabs.length : tabs.length <= 4 ? 2 : 3;

  return (
    <div
      className="h-full w-full p-1.5 gap-1.5 grid overflow-hidden"
      style={{
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridAutoRows: '1fr',
      }}
    >
      {tabs.map((tab) => (
        <SplitPane
          key={tab.id}
          tab={tab}
          isFocused={tab.id === activeTabId}
          projects={projects}
          ws={ws}
          sendMessage={sendMessage}
          latestMessage={latestMessage}
          processingSessions={processingSessions}
          onFocus={() => onFocusTab(tab.id)}
          onSessionActive={onSessionActive}
          onSessionInactive={onSessionInactive}
          onSessionProcessing={onSessionProcessing}
          onSessionNotProcessing={onSessionNotProcessing}
        />
      ))}
    </div>
  );
}

function SplitPane({
  tab,
  isFocused,
  projects,
  ws,
  sendMessage,
  latestMessage,
  processingSessions,
  onFocus,
  onSessionActive,
  onSessionInactive,
  onSessionProcessing,
  onSessionNotProcessing,
}: {
  tab: AppSessionTab;
  isFocused: boolean;
  projects: Project[];
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  latestMessage: unknown;
  processingSessions: Map<string, number>;
  onFocus: () => void;
  onSessionActive: (sessionId?: string | null) => void;
  onSessionInactive: (sessionId?: string | null) => void;
  onSessionProcessing: (sessionId?: string | null) => void;
  onSessionNotProcessing: (sessionId?: string | null) => void;
}) {
  const { project, session } = useMemo(() => resolveTabContext(tab, projects), [tab, projects]);
  const projectName = project?.displayName ?? 'Unknown';

  return (
    <div
      onClick={onFocus}
      className={`flex flex-col h-full overflow-hidden rounded-lg border transition-all ${
        isFocused
          ? 'border-primary/60 shadow-md shadow-primary/10'
          : 'border-border/50 hover:border-border'
      }`}
    >
      {/* Pane header */}
      <div className={`flex items-center gap-2 px-3 py-1 border-b shrink-0 ${
        isFocused ? 'border-primary/30 bg-primary/5' : 'border-border/40 bg-muted/30'
      }`}>
        <MessageSquare className="w-3 h-3 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium truncate text-foreground">{tab.title || 'New Tab'}</span>
        <span className="text-[10px] text-muted-foreground ml-auto flex items-center gap-1 shrink-0">
          <Folder className="w-2.5 h-2.5" />
          {projectName}
        </span>
      </div>

      {/* Chat content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {project && session ? (
          <ChatInterface
            selectedProject={project}
            selectedSession={session}
            ws={ws}
            sendMessage={sendMessage}
            latestMessage={latestMessage}
            processingSessions={processingSessions}
            onSessionActive={onSessionActive}
            onSessionInactive={onSessionInactive}
            onSessionProcessing={onSessionProcessing}
            onSessionNotProcessing={onSessionNotProcessing}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            {!project ? 'Project not found' : 'No session selected'}
          </div>
        )}
      </div>
    </div>
  );
}
