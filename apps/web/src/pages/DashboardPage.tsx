import { ProjectCard } from '../components/ProjectCard';
import { demoProjects } from '../seedData';

export function DashboardPage() {
  return (
    <section>
      <div className="section-head">
        <div>
          <h2>Your Music Projects</h2>
          <p>All songs, stems, notes, and tasks in one place.</p>
        </div>
        <button className="button">New Project</button>
      </div>

      <div className="project-grid">
        {demoProjects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>
    </section>
  );
}
