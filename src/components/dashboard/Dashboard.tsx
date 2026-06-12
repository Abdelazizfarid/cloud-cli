import { useState, useMemo } from 'react';
import { Folder, MessageSquare, Play, Square, Clock, LayoutGrid, List, Trash2 } from 'lucide-react';
import type { Project, ProjectSession } from '../../types/app';

type ViewMode = 'projects' | 'sessions';

interface DashboardProps {
  projects: Project[];
  activeSessions: Set<string>;
  processingSessions: Set<string>;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: ProjectSession) => void;
  onProjectDelete?: (projectId: string, force: boolean) => void;
}

function getAllSessions(project: Project): ProjectSession[] {
  return [
    ...(project.sessions ?? []),
    ...(project.cursorSessions ?? []),
    ...(project.codexSessions ?? []),
    ...(project.geminiSessions ?? []),
    ...(project.opencodeSessions ?? []),
  ].map((s) => ({ ...s, __projectId: project.projectId }));
}

function formatTime(dateStr?: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export default function Dashboard({
  projects,
  activeSessions,
  processingSessions,
  onProjectSelect,
  onSessionSelect,
  onProjectDelete,
}: DashboardProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('projects');
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);

  const allSessions = useMemo(() => {
    const sessions: (ProjectSession & { _projectName: string })[] = [];
    for (const project of projects) {
      for (const session of getAllSessions(project)) {
        sessions.push({ ...session, _projectName: project.displayName });
      }
    }
    sessions.sort((a, b) => {
      const aTime = a.updated_at || a.created_at || a.createdAt || '';
      const bTime = b.updated_at || b.created_at || b.createdAt || '';
      return bTime.localeCompare(aTime);
    });
    return sessions;
  }, [projects]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 px-5 py-3 shrink-0">
        <h1 className="text-base font-semibold text-foreground">Dashboard</h1>
        <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-0.5">
          <button
            onClick={() => setViewMode('projects')}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              viewMode === 'projects'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            Projects
          </button>
          <button
            onClick={() => setViewMode('sessions')}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              viewMode === 'sessions'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <List className="w-3.5 h-3.5" />
            Sessions
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {viewMode === 'projects' ? (
          <ProjectsView
            projects={projects}
            activeSessions={activeSessions}
            processingSessions={processingSessions}
            expandedProjectId={expandedProjectId}
            onToggleExpand={(id) => setExpandedProjectId(expandedProjectId === id ? null : id)}
            onProjectSelect={onProjectSelect}
            onSessionSelect={onSessionSelect}
          />
        ) : (
          <SessionsView
            sessions={allSessions}
            activeSessions={activeSessions}
            processingSessions={processingSessions}
            onSessionSelect={onSessionSelect}
          />
        )}
      </div>
    </div>
  );
}

// --- Projects View ---

function ProjectsView({
  projects,
  activeSessions,
  processingSessions,
  expandedProjectId,
  onToggleExpand,
  onProjectSelect,
  onSessionSelect,
}: {
  projects: Project[];
  activeSessions: Set<string>;
  processingSessions: Set<string>;
  expandedProjectId: string | null;
  onToggleExpand: (id: string) => void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: ProjectSession) => void;
}) {
  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
        <Folder className="w-10 h-10 mb-2 opacity-40" />
        <p className="text-sm">No projects found</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => {
        const sessions = getAllSessions(project);
        const runningCount = sessions.filter((s) => activeSessions.has(s.id) || processingSessions.has(s.id)).length;
        const isExpanded = expandedProjectId === project.projectId;

        return (
          <div
            key={project.projectId}
            className="rounded-lg border border-border/60 bg-card/50 overflow-hidden transition-shadow hover:shadow-md"
          >
            {/* Project Header */}
            <div
              onClick={() => onToggleExpand(project.projectId)}
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                <Folder className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{project.displayName}</p>
                <p className="text-xs text-muted-foreground">
                  {sessions.length} session{sessions.length !== 1 ? 's' : ''}
                  {runningCount > 0 && (
                    <span className="ml-1.5 text-green-500">• {runningCount} running</span>
                  )}
                </p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (onProjectDelete && confirm(`Delete project "${project.displayName}" and all its sessions?`)) {
                    onProjectDelete(project.projectId, true);
                  }
                }}
                className="text-xs text-red-500 hover:text-red-400 shrink-0 p-1"
                title="Delete project"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onProjectSelect(project); }}
                className="text-xs text-primary hover:underline shrink-0"
              >
                Open
              </button>
            </div>

            {/* Expanded Sessions */}
            {isExpanded && sessions.length > 0 && (
              <div className="border-t border-border/40 bg-muted/20 max-h-48 overflow-y-auto">
                {sessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    isActive={activeSessions.has(session.id)}
                    isProcessing={processingSessions.has(session.id)}
                    onSelect={() => onSessionSelect(session)}
                  />
                ))}
              </div>
            )}
            {isExpanded && sessions.length === 0 && (
              <div className="border-t border-border/40 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
                No sessions yet
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Sessions View ---

function SessionsView({
  sessions,
  activeSessions,
  processingSessions,
  onSessionSelect,
}: {
  sessions: (ProjectSession & { _projectName: string })[];
  activeSessions: Set<string>;
  processingSessions: Set<string>;
  onSessionSelect: (session: ProjectSession) => void;
}) {
  const running = sessions.filter((s) => activeSessions.has(s.id) || processingSessions.has(s.id));
  const stopped = sessions.filter((s) => !activeSessions.has(s.id) && !processingSessions.has(s.id));

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
        <MessageSquare className="w-10 h-10 mb-2 opacity-40" />
        <p className="text-sm">No sessions found</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Running */}
      {running.length > 0 && (
        <div>
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-green-500 mb-2 px-1">
            <Play className="w-3 h-3" />
            Running ({running.length})
          </h3>
          <div className="space-y-1">
            {running.map((session) => (
              <SessionRowFull
                key={session.id}
                session={session}
                projectName={session._projectName}
                status="running"
                isProcessing={processingSessions.has(session.id)}
                onSelect={() => onSessionSelect(session)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Stopped */}
      <div>
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
          <Square className="w-3 h-3" />
          Stopped ({stopped.length})
        </h3>
        <div className="space-y-1">
          {stopped.slice(0, 50).map((session) => (
            <SessionRowFull
              key={session.id}
              session={session}
              projectName={session._projectName}
              status="stopped"
              isProcessing={false}
              onSelect={() => onSessionSelect(session)}
            />
          ))}
          {stopped.length > 50 && (
            <p className="text-xs text-muted-foreground px-3 py-1">
              +{stopped.length - 50} more sessions
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Session Row (compact, for project expand) ---

function SessionRow({
  session,
  isActive,
  isProcessing,
  onSelect,
}: {
  session: ProjectSession;
  isActive: boolean;
  isProcessing: boolean;
  onSelect: () => void;
}) {
  const status = isProcessing ? 'processing' : isActive ? 'running' : 'stopped';

  return (
    <button
      onClick={onSelect}
      className="flex items-center gap-2 w-full px-4 py-2 text-left hover:bg-muted/40 transition-colors"
    >
      <StatusDot status={status} />
      <span className="text-xs text-foreground truncate flex-1">
        {session.title || session.summary || session.id.slice(0, 8)}
      </span>
      <span className="text-[10px] text-muted-foreground shrink-0">
        {formatTime(session.updated_at || session.created_at || session.createdAt)}
      </span>
    </button>
  );
}

// --- Session Row (full, for sessions view) ---

function SessionRowFull({
  session,
  projectName,
  status,
  isProcessing,
  onSelect,
}: {
  session: ProjectSession;
  projectName: string;
  status: 'running' | 'stopped';
  isProcessing: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className="flex items-center gap-3 w-full px-3 py-2.5 rounded-md text-left hover:bg-muted/40 transition-colors group"
    >
      <StatusDot status={isProcessing ? 'processing' : status} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">
          {session.title || session.summary || session.id.slice(0, 12)}
        </p>
        <p className="text-[11px] text-muted-foreground truncate flex items-center gap-1.5">
          <Folder className="w-3 h-3 inline shrink-0" />
          {projectName}
          {(session.updated_at || session.created_at || session.createdAt) && (
            <>
              <Clock className="w-3 h-3 inline shrink-0 ml-1.5" />
              {formatTime(session.updated_at || session.created_at || session.createdAt)}
            </>
          )}
        </p>
      </div>
      {isProcessing && (
        <div className="w-4 h-4 shrink-0">
          <div
            className="w-full h-full rounded-full border-2 border-muted border-t-primary"
            style={{ animation: 'spin 1s linear infinite' }}
          />
        </div>
      )}
    </button>
  );
}

// --- Status Dot ---

function StatusDot({ status }: { status: 'running' | 'processing' | 'stopped' }) {
  const colors = {
    running: 'bg-green-500 shadow-green-500/40',
    processing: 'bg-amber-500 shadow-amber-500/40 animate-pulse',
    stopped: 'bg-muted-foreground/40',
  };

  return (
    <span className={`w-2 h-2 rounded-full shrink-0 ${colors[status]} ${status !== 'stopped' ? 'shadow-sm' : ''}`} />
  );
}
