import { Link, useParams } from 'react-router-dom';
import { demoProjectDetails } from '../seedData';

export function ProjectPage() {
  const { projectId } = useParams();
  const project = demoProjectDetails.find((item) => item.id === projectId);

  if (!project) {
    return <p>Project not found.</p>;
  }

  return (
    <section>
      <div className="section-head">
        <div>
          <h2>{project.title}</h2>
          <p>{project.description}</p>
        </div>
        <div className="chip-wrap">
          <span className="badge">Drive: {project.driveSyncStatus}</span>
          <button className="button">Sync now</button>
        </div>
      </div>

      <div className="song-list">
        {project.songs.map((song) => (
          <article className="song-item" key={song.id}>
            <div>
              <h3>{song.title}</h3>
              <p>{song.status}</p>
            </div>
            <div className="chip-wrap">
              <span>{song.assetCount} assets</span>
              <span>{song.taskOpenCount} open tasks</span>
              <Link to={`/projects/${project.id}/songs/${song.id}`}>Open song</Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
