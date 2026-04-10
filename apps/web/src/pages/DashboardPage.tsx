import type { CreateProjectRequest, ProjectDetails, ProjectSummary } from '@studioflow/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { apiRequest } from '../lib/api';
import { ProjectCard } from '../components/ProjectCard';
import './DashboardPage.css';

export function DashboardPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [genre, setGenre] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<ProjectSummary[]>('/projects')
      .then(setProjects)
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load projects');
      });
  }, []);

  const createProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

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
      window.location.href = `/projects/${project.id}`;
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to create project');
    }
  };

  return (
    <section>
      <div className="page-header">
        <div className="page-header__main">
          <h2>Projects</h2>
          <p>Songs, stems, notes, and tasks — all in one place.</p>
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
            <button className="btn btn-primary" type="submit">Create</button>
          </form>
          {error && <p className="form-error" style={{ marginTop: '10px' }}>{error}</p>}
        </div>
      </div>

      {projects.length ? (
        <div className="project-grid">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
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
