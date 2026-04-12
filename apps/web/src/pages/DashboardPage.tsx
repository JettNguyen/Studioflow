import type { CreateProjectRequest, ProjectDetails, ProjectSummary } from '@studioflow/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCamera } from '@fortawesome/free-solid-svg-icons';
import { apiRequest, apiUploadWithProgress, resolveApiUrl } from '../lib/api';
import './DashboardPage.css';

type ProjectSummaryWithAssetCount = ProjectSummary & { projectAssetCount: number };

interface ProjectCardProps {
  project: ProjectSummaryWithAssetCount;
  onCoverUpload?: (file: File) => void;
}

function ProjectCard({ project, onCoverUpload }: ProjectCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="project-card-wrap">
      {project.coverImageUrl && (
        <div className="project-card__cover">
          <img
            src={resolveApiUrl(project.coverImageUrl)}
            alt={`${project.title} cover`}
            className="project-card__cover-img"
          />
          {onCoverUpload && (
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
            <span className={`badge ${project.released ? 'badge-green' : 'badge-default'}`}>
              {project.released ? 'Released' : 'Unreleased'}
            </span>
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
    const fd = new FormData();
    fd.append('image', file);
    try {
      const updated = await apiUploadWithProgress<ProjectDetails>(
        `/projects/${projectId}/cover`,
        fd,
        () => {}
      );
      setProjects(prev => prev.map(p => p.id === projectId
        ? { ...p, coverImageUrl: updated.coverImageUrl }
        : p
      ));
    } catch {
      // non-blocking — user can retry
    }
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
