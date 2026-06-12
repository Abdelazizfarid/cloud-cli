import { useState, useMemo, useEffect, useCallback } from 'react';
import { Folder, MessageSquare, Play, Square, Clock, LayoutGrid, List, Trash2, Archive, FileText, X, Save, ChevronDown, ChevronRight, Globe } from 'lucide-react';
import type { Project, ProjectSession } from '../../types/app';
import { api } from '../../utils/api';

type ViewMode = 'projects' | 'sessions';

interface DashboardProps {
  projects: Project[];
  activeSessions: Set<string>;
  processingSessions: Set<string>;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: ProjectSession) => void;
  onProjectDelete?: (projectId: string, force: boolean) => void;
  onProjectArchive?: (projectId: string) => void;
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

// --- Memory File List Modal ---

function MemoryFileList({
  title,
  files,
  projectId,
  onClose,
}: {
  title: string;
  files: { name: string; path: string; size: number }[];
  projectId: string;
  onClose: () => void;
}) {
  const [editingFile, setEditingFile] = useState<{ name: string; content: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const openFile = async (fileName: string) => {
    try {
      const res = await api.getProjectMemoryFile(projectId, fileName);
      const data = await res.json();
      setEditingFile({ name: fileName, content: data.content || '' });
    } catch (e) {
      alert('Failed to load file');
    }
  };

  const saveFile = async () => {
    if (!editingFile) return;
    setSaving(true);
    try {
      const res = await api.saveProjectMemoryFile(projectId, editingFile.name, editingFile.content);
      if (!res.ok) throw new Error('Save failed');
      setEditingFile(null);
    } catch (e) {
      alert('Failed to save: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex flex-col w-full max-w-4xl h-[80vh] rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">
              {editingFile ? `${title} / ${editingFile.name}` : title}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {editingFile && (
              <>
                <button
                  onClick={saveFile}
                  disabled={saving}
                  className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => setEditingFile(null)}
                  className="rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted/50"
                >
                  Back
                </button>
              </>
            )}
            <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/50">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {editingFile ? (
          <textarea
            value={editingFile.content}
            onChange={(e) => setEditingFile({ ...editingFile, content: e.target.value })}
            className="flex-1 resize-none bg-background/50 p-4 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            spellCheck={false}
          />
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-1">
            {files.map((file) => (
              <div
                key={file.name}
                onClick={() => openFile(file.name)}
                className="flex items-center gap-3 rounded-lg px-4 py-3 cursor-pointer hover:bg-muted/30 border border-transparent hover:border-border/40 transition-colors"
              >
                <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {file.size < 1024 ? `${file.size}B` : `${(file.size / 1024).toFixed(1)}KB`}
                </span>
              </div>
            ))}
            {files.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No memory files found</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Markdown Editor Modal ---

function MarkdownEditor({
  title,
  content,
  onSave,
  onClose,
}: {
  title: string;
  content: string;
  onSave: (content: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(content);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(value);
      onClose();
    } catch (e) {
      alert('Failed to save: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex flex-col w-full max-w-4xl h-[80vh] rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/50">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="flex-1 resize-none bg-background/50 p-4 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          placeholder="Write markdown content here..."
          spellCheck={false}
        />
      </div>
    </div>
  );
}

export default function Dashboard({
  projects,
  activeSessions,
  processingSessions,
  onProjectSelect,
  onSessionSelect,
  onProjectDelete,
  onProjectArchive,
}: DashboardProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('projects');
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [mdEditor, setMdEditor] = useState<{ title: string; content: string; onSave: (c: string) => Promise<void>; _projectId?: string; _files?: any[] } | null>(null);

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

  const openGlobalClaudeMd = useCallback(async () => {
    try {
      const res = await api.getGlobalClaudeMd();
      const data = await res.json();
      setMdEditor({
        title: 'Global CLAUDE.md',
        content: data.content || '',
        onSave: async (content: string) => {
          const saveRes = await api.saveGlobalClaudeMd(content);
          if (!saveRes.ok) throw new Error('Save failed');
        },
      });
    } catch (e) {
      alert('Failed to load global CLAUDE.md');
    }
  }, []);

  const openProjectClaudeMd = useCallback(async (project: Project) => {
    try {
      const res = await api.getProjectClaudeMd(project.projectId);
      const data = await res.json();
      setMdEditor({
        title: `CLAUDE.md — ${project.displayName}`,
        content: data.content || '',
        onSave: async (content: string) => {
          const saveRes = await api.saveProjectClaudeMd(project.projectId, content);
          if (!saveRes.ok) throw new Error('Save failed');
        },
      });
    } catch (e) {
      alert('Failed to load project CLAUDE.md');
    }
  }, []);

  const openProjectMemory = useCallback(async (project: Project) => {
    try {
      const res = await api.getProjectMemory(project.projectId);
      const data = await res.json();
      if (!data.files || data.files.length === 0) {
        alert('No memory files found for this project');
        return;
      }
      setMdEditor({
        title: `Memory Files — ${project.displayName}`,
        content: '__FILE_LIST__' + JSON.stringify(data.files),
        onSave: async () => {},
        _projectId: project.projectId,
        _files: data.files,
      } as any);
    } catch (e) {
      alert('Failed to load project memory files');
    }
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 px-5 py-3 shrink-0">
        <h1 className="text-base font-semibold text-foreground">Dashboard</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={openGlobalClaudeMd}
            className="flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            title="Edit global CLAUDE.md"
          >
            <Globe className="w-3.5 h-3.5" />
            CLAUDE.md
          </button>
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
            onProjectDelete={onProjectDelete}
            onProjectArchive={onProjectArchive}
            onEditClaudeMd={openProjectClaudeMd}
            onEditMemory={openProjectMemory}
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

      {/* Markdown Editor Modal */}
      {mdEditor && mdEditor._files ? (
        <MemoryFileList
          title={mdEditor.title}
          files={mdEditor._files}
          projectId={mdEditor._projectId!}
          onClose={() => setMdEditor(null)}
        />
      ) : mdEditor ? (
        <MarkdownEditor
          title={mdEditor.title}
          content={mdEditor.content}
          onSave={mdEditor.onSave}
          onClose={() => setMdEditor(null)}
        />
      ) : null}
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
  onProjectDelete,
  onProjectArchive,
  onEditClaudeMd,
  onEditMemory,
}: {
  projects: Project[];
  activeSessions: Set<string>;
  processingSessions: Set<string>;
  expandedProjectId: string | null;
  onToggleExpand: (id: string) => void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: ProjectSession) => void;
  onProjectDelete?: (projectId: string, force: boolean) => void;
  onProjectArchive?: (projectId: string) => void;
  onEditClaudeMd: (project: Project) => void;
  onEditMemory: (project: Project) => void;
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
              {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
            </div>

            {/* Action Bar */}
            <div className="flex items-center gap-1 border-t border-border/30 px-3 py-1.5 bg-muted/10">
              <button
                onClick={(e) => { e.stopPropagation(); onProjectSelect(project); }}
                className="rounded px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
              >
                Open
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onEditClaudeMd(project); }}
                className="rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                title="Edit CLAUDE.md"
              >
                CLAUDE.md
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onEditMemory(project); }}
                className="rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                title="Edit Memory"
              >
                Memory
              </button>
              <div className="flex-1" />
              {onProjectArchive && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onProjectArchive(project.projectId);
                  }}
                  className="rounded p-1 text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10 transition-colors"
                  title="Archive project"
                >
                  <Archive className="w-3.5 h-3.5" />
                </button>
              )}
              {onProjectDelete && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Permanently delete "${project.displayName}" and all its sessions?`)) {
                      onProjectDelete(project.projectId, true);
                    }
                  }}
                  className="rounded p-1 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
                  title="Delete project permanently"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
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
  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
        <MessageSquare className="w-10 h-10 mb-2 opacity-40" />
        <p className="text-sm">No sessions found</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {sessions.map((session) => (
        <div
          key={session.id}
          onClick={() => onSessionSelect(session)}
          className="flex items-center gap-3 rounded-lg px-4 py-2.5 cursor-pointer hover:bg-muted/30 transition-colors border border-transparent hover:border-border/40"
        >
          <div className="flex items-center gap-2">
            {activeSessions.has(session.id) || processingSessions.has(session.id) ? (
              <Play className="w-3 h-3 text-green-500 fill-green-500" />
            ) : (
              <Square className="w-3 h-3 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-foreground truncate">
              {session.summary || session.id.slice(0, 8)}
            </p>
            <p className="text-xs text-muted-foreground">{session._projectName}</p>
          </div>
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatTime(session.updated_at || session.created_at || session.createdAt)}
          </span>
        </div>
      ))}
    </div>
  );
}

// --- Session Row ---

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
  return (
    <div
      onClick={onSelect}
      className="flex items-center gap-2 px-4 py-2 cursor-pointer hover:bg-muted/40 transition-colors"
    >
      {isActive || isProcessing ? (
        <Play className="w-3 h-3 text-green-500 fill-green-500 shrink-0" />
      ) : (
        <MessageSquare className="w-3 h-3 text-muted-foreground shrink-0" />
      )}
      <span className="text-xs text-foreground truncate flex-1">
        {session.summary || session.id.slice(0, 8)}
      </span>
      <span className="text-xs text-muted-foreground shrink-0">
        {formatTime(session.updated_at || session.created_at || session.createdAt)}
      </span>
    </div>
  );
}
