import type { CreateSongRequest, ProjectDetails, SongWorkspace } from '@studioflow/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiRequest } from '../lib/api';

export function ProjectPage() {
  const { projectId } = useParams();
  const [project, setProject] = useState<ProjectDetails | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      return;
    }

    apiRequest<ProjectDetails>(`/projects/${projectId}`)
      .then(setProject)
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load project');
      });
  }, [projectId]);

  const createSong = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!projectId) {
      return;
    }

    try {
      const song = await apiRequest<SongWorkspace>(`/songs/project/${projectId}`, {
        method: 'POST',
        body: {
          title
        } satisfies CreateSongRequest
      });

      setTitle('');
      window.location.href = `/projects/${projectId}/songs/${song.id}`;
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to create song');
    }
  };

  if (!project) {
    return <p>{error ?? 'Loading project...'}</p>;
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
          <span>{project.driveFolderId ? 'Folder linked' : 'No Drive folder yet'}</span>
        </div>
      </div>

      <article className="panel form-panel">
        <h3>Create Song</h3>
        <form className="inline-form" onSubmit={createSong}>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Song title" required />
          <button className="button" type="submit">Create song</button>
        </form>
      </article>

      {project.songs.length ? (
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
      ) : (
        <article className="panel empty-panel">
          <h3>No songs yet</h3>
          <p>Create the first song in this project to start working.</p>
        </article>
      )}
    </section>
  );
}
