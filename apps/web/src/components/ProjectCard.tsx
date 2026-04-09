import type { ProjectSummary } from '@studioflow/shared';
import { Link } from 'react-router-dom';

interface ProjectCardProps {
  project: ProjectSummary;
}

export function ProjectCard({ project }: ProjectCardProps) {
  return (
    <Link to={`/projects/${project.id}`} className="project-card" aria-label={`Open project ${project.title}`}>
      <div className="project-card__head">
        <span className="badge">{project.genre}</span>
        <span>{project.collaboratorCount} collaborators</span>
      </div>
      <h3>{project.title}</h3>
      <p>{project.description}</p>
      <div className="project-card__footer">
        <span>{project.songCount} songs</span>
      </div>
    </Link>
  );
}
