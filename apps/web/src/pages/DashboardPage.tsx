import type { CreateProjectRequest, ProjectDetails, ProjectSummary, ReorderProjectsRequest } from '@studioflow/shared';
import { useEffect, useState, type DragEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGripVertical } from '@fortawesome/free-solid-svg-icons';
import { apiRequest, resolveApiUrl } from '../lib/api';
import './DashboardPage.css';


type ProjectSummaryWithAssetCount = ProjectSummary & { projectAssetCount: number };

interface ProjectCardProps {
  project: ProjectSummaryWithAssetCount;
  isDragOver?: boolean;
  isDragging?: boolean;
  onDragStart?: (e: DragEvent<HTMLDivElement>) => void;
  onDragOver?: (e: DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (e: DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (e: DragEvent<HTMLDivElement>) => void;
}

function ProjectCard({
  project,
  isDragOver,
  isDragging,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: ProjectCardProps) {
  return (
    <div
      className={`project-card-wrap${isDragOver ? ' drag-over' : ''}${isDragging ? ' dragging' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <div className="project-card__drag-handle" aria-hidden="true">
        <FontAwesomeIcon icon={faGripVertical} />
      </div>
      {project.coverImageUrl && (
        <div className="project-card__cover">
          <img
            src={resolveApiUrl(project.coverImageUrl)}
            alt=""
            aria-hidden="true"
            className="project-card__cover-bg"
          />
          <img
            src={resolveApiUrl(project.coverImageUrl)}
            alt={`${project.title} cover`}
            className="project-card__cover-img"
          />
        </div>
      )}

      <Link to={`/projects/${project.id}`} className="project-card" aria-label={`Open project ${project.title}`}>
        <div className="project-card__top">
          <div className="project-card__top-left">
            {project.genre && project.genre !== 'Unspecified' && (
              <span className="badge badge-accent">{project.genre}</span>
            )}
            <div className="project-card__title-col">
              <h3 className="project-card__title">{project.title}</h3>
            </div>
          </div>

          <div className="project-card__meta-col">
            <span
              className={`status-dot ${project.released ? 'status-dot--released' : 'status-dot--unreleased'}`}
              title={project.released ? 'Released' : 'Unreleased'}
              aria-label={project.released ? 'Released' : 'Unreleased'}
            />
            <span className="project-card__collab">
              {project.collaboratorCount === 1 ? '1 collaborator' : `${project.collaboratorCount} collaborators`}
            </span>
          </div>
        </div>
        {project.description ? <p>{project.description}</p> : null}
        <div className="project-card__footer">
          <span className="project-card__stat">{project.songCount} {project.songCount === 1 ? 'song' : 'songs'}</span>
          <span className="project-card__stat">{project.projectAssetCount} {project.projectAssetCount === 1 ? 'project file' : 'project files'}</span>
        </div>
      </Link>

    </div>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummaryWithAssetCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [genre, setGenre] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);
  const [dragOverProjectId, setDragOverProjectId] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<ProjectSummaryWithAssetCount[]>('/projects')
      .then(setProjects)
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load projects');
      })
      .finally(() => setLoading(false));
  }, []);

  const createProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setCreating(true);

    try {
      const project = await apiRequest<ProjectDetails>('/projects', {
        method: 'POST',
        body: {
          title,
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(genre.trim() ? { genre: genre.trim() } : {})
        } satisfies CreateProjectRequest
      });

      setTitle('');
      setDescription('');
      setGenre('');
      navigate(`/projects/${project.id}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to create project');
      setCreating(false);
    }
  };

  const reorderProjects = async (newOrder: string[]) => {
    try {
      await apiRequest('/projects/reorder', {
        method: 'POST',
        body: { order: newOrder } satisfies ReorderProjectsRequest
      });
    } catch {
      // non-blocking — optimistic order already applied
    }
  };

  const onDragStart = (e: DragEvent<HTMLDivElement>, projectId: string) => {
    setDraggedProjectId(projectId);
    e.dataTransfer.setData('text/plain', projectId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>, targetId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const fromId = e.dataTransfer.getData('text/plain') || draggedProjectId;
    if (!fromId || fromId === targetId) return;
    if (dragOverProjectId !== targetId) setDragOverProjectId(targetId);
    setProjects(current => {
      const fromIndex = current.findIndex(p => p.id === fromId);
      const toIndex = current.findIndex(p => p.id === targetId);
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return current;
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOverProjectId(null);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOverProjectId(null);
    setDraggedProjectId(null);
    setProjects(current => {
      reorderProjects(current.map(p => p.id));
      return current;
    });
  };

  const onDragEnd = () => {
    setDraggedProjectId(null);
    setDragOverProjectId(null);
  };

  return (
    <section>
      <div className="page-header">
        <div className="page-header__main">
          <h2>Projects</h2>
          <p>Songs, notes, videos, and collaboration — all in one place.</p>
        </div>
      </div>

      <div className="dashboard-create">
        <p className="dashboard-create__title">New project</p>
        <div className="card">
          <form className="form-row" onSubmit={createProject}>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Project title"
              required
            />
            <input
              className="input"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              placeholder="Genre (optional)"
            />
            <input
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
            />
            <button className="btn btn-primary" type="submit" disabled={creating || title.trim() === ''}>
              {creating ? 'Creating…' : 'Create'}
            </button>
          </form>
          {error && <p className="form-error" style={{ marginTop: '10px' }}>{error}</p>}
        </div>
      </div>

      {loading ? (
        <div className="project-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="project-card-wrap project-card--skeleton">
              <div className="project-card">
                <div className="skeleton skeleton--badge" />
                <div className="skeleton skeleton--title" />
                <div className="skeleton skeleton--line" />
                <div className="skeleton skeleton--line skeleton--line-short" />
              </div>
            </div>
          ))}
        </div>
      ) : projects.length ? (
        <div className="project-grid">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              isDragging={draggedProjectId === project.id}
              isDragOver={dragOverProjectId === project.id}
              onDragStart={(e) => onDragStart(e, project.id)}
              onDragOver={(e) => onDragOver(e, project.id)}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onDragEnd={onDragEnd}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <h3>No projects yet</h3>
          <p>Create your first project to start organizing songs, notes, and collaborators.</p>
        </div>
      )}
    </section>
  );
}
