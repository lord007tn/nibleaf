import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Project } from '@/hooks/api';
import { useProjects } from '@/hooks/api';

const STORAGE_KEY = 'plume.activeProjectId';

interface ProjectContextValue {
  activeProject: Project | null;
  activeProjectId: string | undefined;
  projects: Project[];
  isLoading: boolean;
  isError: boolean;
  setActiveProject: (projectId: string) => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

const readStored = (): string | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { data: projects, isPending, isError } = useProjects();
  const [selectedId, setSelectedId] = useState<string | null>(() => readStored());
  const list = useMemo(() => projects ?? [], [projects]);

  useEffect(() => {
    const first = list[0];
    if (!first) {
      return;
    }
    const stillValid = selectedId && list.some((p) => p.id === selectedId);
    if (!stillValid) {
      setSelectedId(first.id);
      try {
        window.localStorage.setItem(STORAGE_KEY, first.id);
      } catch {
        // ignore
      }
    }
  }, [list, selectedId]);

  const setActiveProject = useCallback((projectId: string) => {
    setSelectedId(projectId);
    try {
      window.localStorage.setItem(STORAGE_KEY, projectId);
    } catch {
      // ignore
    }
  }, []);

  const activeProject = useMemo(() => list.find((p) => p.id === selectedId) ?? null, [list, selectedId]);

  const value = useMemo<ProjectContextValue>(
    () => ({ activeProject, activeProjectId: activeProject?.id, projects: list, setActiveProject, isLoading: isPending, isError }),
    [activeProject, list, setActiveProject, isPending, isError],
  );

  return <ProjectContext value={value}>{children}</ProjectContext>;
}

export function useActiveProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error('useActiveProject must be used within a ProjectProvider');
  }
  return ctx;
}
