import type { ProjectSummary } from '@studioflow/shared';
import { Link } from 'react-router-dom';
import './ProjectCard.css';

interface ProjectCardProps {
  project: ProjectSummary;
}

export function ProjectCard({ project }: ProjectCardProps) {
  return (
    <Link to={`/projects/${project.id}`} className="project-card" aria-label={`Open project ${project.title}`}>
      <div className="project-card__top">
        {project.genre ? (
          <span className="badge badge-accent">{project.genre}</span>
        ) : (
          <span className="badge badge-default">No genre</span>
        )}
        <span className="project-card__collab">
          {project.collaboratorCount === 1 ? '1 collaborator' : `${project.collaboratorCount} collaborators`}
        </span>
      </div>
      <h3>{project.title}</h3>
      <p>{project.description || 'No description.'}</p>
      <div className="project-card__footer">
        <span className="project-card__stat">{project.songCount} {project.songCount === 1 ? 'song' : 'songs'}</span>
      </div>
    </Link>
  );
}
