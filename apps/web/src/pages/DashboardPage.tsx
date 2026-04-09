import type { CreateProjectRequest, ProjectDetails, ProjectSummary } from '@studioflow/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { apiRequest } from '../lib/api';
import { ProjectCard } from '../components/ProjectCard';

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
      <div className="section-head">
        <div>
          <h2>Your Music Projects</h2>
          <p>All songs, stems, notes, and tasks in one place.</p>
        </div>
      </div>

      <article className="panel form-panel">
        <h3>Create Project</h3>
        <form className="inline-form" onSubmit={createProject}>
          <input 
            value={title} 
            onChange={(event) => setTitle(event.target.value)} 
            placeholder="Project title" required />
          <input 
            value={genre} 
            onChange={(event) => setGenre(event.target.value)} 
            placeholder="Genre (optional)" />
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Description (optional)"
          />
          <button className="button" type="submit">Create project</button>
        </form>
        {error ? <p className="form-error">{error}</p> : null}
      </article>

      {projects.length ? (
        <div className="project-grid">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      ) : (
        <article className="panel empty-panel">
          <h3>No projects yet</h3>
          <p>Create your first project to start organizing songs, notes, and collaborators.</p>
        </article>
      )}
    </section>
  );
}
