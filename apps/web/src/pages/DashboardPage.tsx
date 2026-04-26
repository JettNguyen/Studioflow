import type { CreateProjectRequest, ProjectDetails, ProjectSummary, ReorderProjectsRequest } from '@studioflow/shared';
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCamera, faGripVertical } from '@fortawesome/free-solid-svg-icons';
import { apiRequest, apiUploadWithProgress, resolveApiUrl } from '../lib/api';
import './DashboardPage.css';

/** Resize + compress an image file to fit within maxDim px and target ~qualityMB MB. */
async function compressImage(file: File, maxDim = 1200, quality = 0.82): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (!blob || blob.size >= file.size) {
            resolve(file);
          } else {
            resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
          }
        },
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

type ProjectSummaryWithAssetCount = ProjectSummary & { projectAssetCount: number };

interface ProjectCardProps {
  project: ProjectSummaryWithAssetCount;
  onCoverUpload?: (file: File) => void;
  uploadingCover?: boolean;
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
  onCoverUpload,
  uploadingCover,
  isDragOver,
  isDragging,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: ProjectCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

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
            alt={`${project.title} cover`}
            className="project-card__cover-img"
          />
          {uploadingCover && (
            <div className="project-card__cover-loading">
              <div className="project-card__cover-spinner" />
            </div>
          )}
          {onCoverUpload && !uploadingCover && (
            <button
              className="project-card__cover-edit"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Change cover image"
              type="button"
            >
              <FontAwesomeIcon icon={faCamera} />
            </button>
          )}
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
              {onCoverUpload && !project.coverImageUrl && (
                <button
                  className="btn btn-ghost btn-icon project-card__upload-btn"
                  onClick={e => { e.preventDefault(); fileInputRef.current?.click(); }}
                  aria-label="Upload cover image"
                  type="button"
                  title="Add cover image"
                >
                  <FontAwesomeIcon icon={faCamera} />
                </button>
              )}
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

      {onCoverUpload && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) { onCoverUpload(file); e.target.value = ''; }
          }}
        />
      )}
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
  const [uploadingCoverId, setUploadingCoverId] = useState<string | null>(null);
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

  const uploadCover = async (projectId: string, file: File) => {
    const compressed = await compressImage(file);
    const fd = new FormData();
    fd.append('image', compressed);
    setUploadingCoverId(projectId);
    try {
      const updated = await apiUploadWithProgress<ProjectDetails>(
        `/projects/${projectId}/cover`,
        fd,
        () => {}
      );
      const bust = `?t=${Date.now()}`;
      setProjects(prev => prev.map(p => p.id === projectId
        ? { ...p, coverImageUrl: updated.coverImageUrl ? updated.coverImageUrl + bust : updated.coverImageUrl }
        : p
      ));
    } catch {
      // non-blocking — user can retry
    } finally {
      setUploadingCoverId(null);
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
    const fromId = draggedProjectId || e.dataTransfer.getData('text/plain');
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
              onCoverUpload={(file) => uploadCover(project.id, file)}
              uploadingCover={uploadingCoverId === project.id}
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
