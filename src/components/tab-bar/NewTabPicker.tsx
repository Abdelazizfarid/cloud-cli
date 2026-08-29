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

  const getSessions = (project: Project): ProjectSession[] => project.sessions ?? [];

  if (!selectedProject) {
    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
        <div className="w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-lg">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Select a project</h3>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {projects.map((project) => (
              <button
                key={project.projectId}
                onClick={() => setSelectedProject(project)}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50"
              >
                <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{project.displayName}</span>
              </button>
            ))}
          </div>
          <button
            onClick={onCancel}
            className="mt-3 w-full py-1 text-center text-xs text-muted-foreground hover:text-foreground"
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
        <h3 className="mb-1 text-sm font-semibold text-foreground">{selectedProject.displayName}</h3>
        <p className="mb-3 text-xs text-muted-foreground">Choose a session or start new</p>
        <button
          onClick={() => onSelect(selectedProject, null)}
          className="mb-2 flex w-full items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-left text-sm font-medium text-primary transition-colors hover:bg-primary/20"
        >
          <Plus className="h-4 w-4 shrink-0" />
          <span>New Session</span>
        </button>
        {sessions.length > 0 && (
          <div className="max-h-52 space-y-1 overflow-y-auto">
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => onSelect(selectedProject, session)}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50"
              >
                <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{session.title || session.summary || session.id}</span>
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => setSelectedProject(null)}
          className="mt-3 w-full py-1 text-center text-xs text-muted-foreground hover:text-foreground"
        >
          ← Back to projects
        </button>
      </div>
    </div>
  );
}
