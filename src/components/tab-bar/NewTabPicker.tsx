import { useState } from 'react';
import { Folder, MessageSquare, Plus } from 'lucide-react';
import type { Project, ProjectSession } from '../../types/app';

interface NewTabPickerProps {
  projects: Project[];
  onSelect: (project: Project, session: ProjectSession | null) => void;
  onCancel: () => void;
}

export default function NewTabPicker({ projects, onSelect, onCancel }: NewTabPickerProps) {
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);

  const getSessions = (project: Project): ProjectSession[] => [
    ...(project.sessions ?? []),
    ...(project.cursorSessions ?? []),
    ...(project.codexSessions ?? []),
    ...(project.geminiSessions ?? []),
    ...(project.opencodeSessions ?? []),
  ];

  if (!selectedProject) {
    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
        <div className="w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-lg">
          <h3 className="text-sm font-semibold mb-3 text-foreground">Select a project</h3>
          <div className="max-h-64 overflow-y-auto space-y-1">
            {projects.map((project) => (
              <button
                key={project.projectId}
                onClick={() => setSelectedProject(project)}
                className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm text-left hover:bg-muted/50 transition-colors"
              >
                <Folder className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="truncate">{project.displayName}</span>
              </button>
            ))}
          </div>
          <button
            onClick={onCancel}
            className="mt-3 w-full text-xs text-muted-foreground hover:text-foreground text-center py-1"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const sessions = getSessions(selectedProject);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-lg">
        <h3 className="text-sm font-semibold mb-1 text-foreground">{selectedProject.displayName}</h3>
        <p className="text-xs text-muted-foreground mb-3">Choose a session or start new</p>
        <button
          onClick={() => onSelect(selectedProject, null)}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm text-left bg-primary/10 hover:bg-primary/20 text-primary font-medium mb-2 transition-colors"
        >
          <Plus className="w-4 h-4 shrink-0" />
          <span>New Session</span>
        </button>
        {sessions.length > 0 && (
          <div className="max-h-52 overflow-y-auto space-y-1">
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => onSelect(selectedProject, session)}
                className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm text-left hover:bg-muted/50 transition-colors"
              >
                <MessageSquare className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="truncate">{session.title || session.summary || session.id}</span>
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => setSelectedProject(null)}
          className="mt-3 w-full text-xs text-muted-foreground hover:text-foreground text-center py-1"
        >
          ← Back to projects
        </button>
      </div>
    </div>
  );
}
