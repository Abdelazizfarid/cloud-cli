import { useMemo } from 'react';
import { Folder, MessageSquare } from 'lucide-react';

import ChatInterface from '../chat/view/ChatInterface';
import type { AppSessionTab } from '../../hooks/useTabsState';
import type { Project, ProjectSession } from '../../types/app';
import type { MarkSessionIdle, MarkSessionProcessing, SessionActivityMap } from '../../hooks/useSessionProtection';

interface SplitViewProps {
  tabs: AppSessionTab[];
  activeTabId: string | null;
  projects: Project[];
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  processingSessions: SessionActivityMap;
  onFocusTab: (tabId: string) => void;
  onSessionProcessing: MarkSessionProcessing;
  onSessionIdle: MarkSessionIdle;
}

function resolveTabContext(tab: AppSessionTab, projects: Project[]): { project: Project | null; session: ProjectSession | null } {
  const project = projects.find((p) => p.projectId === tab.projectId) ?? null;
  if (!project || !tab.sessionId) return { project, session: null };
  const allSessions = project.sessions ?? [];
  const session = allSessions.find((s) => s.id === tab.sessionId) ?? null;
  return { project, session };
}

export default function SplitView({
  tabs,
  activeTabId,
  projects,
  ws,
  sendMessage,
  processingSessions,
  onFocusTab,
  onSessionProcessing,
  onSessionIdle,
}: SplitViewProps) {
  const cols = tabs.length <= 2 ? tabs.length : tabs.length <= 4 ? 2 : 3;

  return (
    <div
      className="grid h-full w-full gap-1.5 overflow-hidden p-1.5"
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
          processingSessions={processingSessions}
          onFocus={() => onFocusTab(tab.id)}
          onSessionProcessing={onSessionProcessing}
          onSessionIdle={onSessionIdle}
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
  processingSessions,
  onFocus,
  onSessionProcessing,
  onSessionIdle,
}: {
  tab: AppSessionTab;
  isFocused: boolean;
  projects: Project[];
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  processingSessions: SessionActivityMap;
  onFocus: () => void;
  onSessionProcessing: MarkSessionProcessing;
  onSessionIdle: MarkSessionIdle;
}) {
  const { project, session } = useMemo(() => resolveTabContext(tab, projects), [tab, projects]);
  const projectName = project?.displayName ?? 'Unknown';

  return (
    <div
      onClick={onFocus}
      className={`flex h-full flex-col overflow-hidden rounded-lg border transition-all ${
        isFocused
          ? 'border-primary/60 shadow-md shadow-primary/10'
          : 'border-border/50 hover:border-border'
      }`}
    >
      {/* Pane header */}
      <div className={`flex shrink-0 items-center gap-2 border-b px-3 py-1 ${
        isFocused ? 'border-primary/30 bg-primary/5' : 'border-border/40 bg-muted/30'
      }`}>
        <MessageSquare className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="truncate text-xs font-medium text-foreground">{tab.title || 'New Tab'}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
          <Folder className="h-2.5 w-2.5" />
          {projectName}
        </span>
      </div>

      {/* Chat content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {project && session ? (
          <ChatInterface
            isActive
            selectedProject={project}
            selectedSession={session}
            ws={ws}
            sendMessage={sendMessage}
            processingSessions={processingSessions}
            onSessionProcessing={onSessionProcessing}
            onSessionIdle={onSessionIdle}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            {!project ? 'Project not found' : 'No session selected'}
          </div>
        )}
      </div>
    </div>
  );
}
