import type { CreateSongRequest, ProjectDetails, SongWorkspace } from '@studioflow/shared';
import { useEffect, useState, type DragEvent, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { Breadcrumb } from '../components/Breadcrumb';
import './ProjectPage.css';

export function ProjectPage() {
  const { projectId } = useParams();
  const [project, setProject] = useState<ProjectDetails | null>(null);
  const [title, setTitle] = useState('');
  const [editingProjectTitle, setEditingProjectTitle] = useState(false);
  const [projectTitleInput, setProjectTitleInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editingSongId, setEditingSongId] = useState<string | null>(null);
  const [editingSongTitle, setEditingSongTitle] = useState('');
  const [draggedSongId, setDraggedSongId] = useState<string | null>(null);
  const [dragOverSongId, setDragOverSongId] = useState<string | null>(null);
  const [previewSongs, setPreviewSongs] = useState<ProjectDetails['songs']>([]);

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

  useEffect(() => {
    if (!project) return;
    setPreviewSongs(project.songs);
  }, [project]);

  const startEditProjectTitle = () => {
    if (!project) return;
    setProjectTitleInput(project.title);
    setEditingProjectTitle(true);
  };

  const saveProjectTitle = async () => {
    if (!projectId) return;
    try {
      const updated = await apiRequest<ProjectDetails>(`/projects/${projectId}`, {
        method: 'PATCH',
        body: { title: projectTitleInput }
      });

      setProject(updated);
      setEditingProjectTitle(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to update project');
    }
  };

  const startEditSongTitle = (songId: string, current: string) => {
    setEditingSongId(songId);
    setEditingSongTitle(current);
  };

  const saveSongTitle = async (songId: string) => {
    try {
      await apiRequest(`/songs/${songId}`, { method: 'PATCH', body: { title: editingSongTitle } });
      // refresh project to get updated song list
      if (projectId) {
        const updated = await apiRequest<ProjectDetails>(`/projects/${projectId}`);
        setProject(updated);
      }
      setEditingSongId(null);
      setEditingSongTitle('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to update song title');
    }
  };

  const reorderSongs = async (newOrder: string[]) => {
    if (!projectId) return;
    try {
      const updated = await apiRequest<ProjectDetails>(`/projects/${projectId}/songs/reorder`, {
        method: 'POST',
        body: { order: newOrder }
      });
      setProject(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to reorder songs');
    }
  };

  const onDragStart = (e: DragEvent<HTMLLIElement>, songId: string) => {
    setDraggedSongId(songId);
    e.dataTransfer?.setData('text/plain', songId);
    e.dataTransfer!.effectAllowed = 'move';
  };

  const onDragOver = (e: DragEvent<HTMLLIElement>, songId: string) => {
    e.preventDefault();
    const fromId = draggedSongId || e.dataTransfer?.getData('text/plain');
    if (!fromId || fromId === songId) return;

    if (dragOverSongId !== songId) setDragOverSongId(songId);

    setPreviewSongs((current) => {
      const fromIndex = current.findIndex((s) => s.id === fromId);
      const toIndex = current.findIndex((s) => s.id === songId);

      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
        return current;
      }

      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const onDragLeave = (e: DragEvent<HTMLLIElement>) => {
    e.preventDefault();
    setDragOverSongId(null);
  };

  const onDrop = (e: DragEvent<HTMLLIElement>, songId: string) => {
    e.preventDefault();
    const fromId = e.dataTransfer?.getData('text/plain') || draggedSongId;
    setDraggedSongId(null);
    setDragOverSongId(null);
    if (!fromId || !songId) return;

    const newOrder = previewSongs.map((s) => s.id);
    reorderSongs(newOrder);
  };

  const onDragEnd = () => {
    setDraggedSongId(null);
    setDragOverSongId(null);
  };

  const createSong = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!projectId) {
      return;
    }

    try {
      const song = await apiRequest<SongWorkspace>(`/songs/project/${projectId}`, {
        method: 'POST',
        body: { title } satisfies CreateSongRequest
      });

      setTitle('');
      window.location.href = `/projects/${projectId}/songs/${song.id}`;
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to create song');
    }
  };

  if (!project) {
    return <p style={{ color: 'var(--text-2)', padding: '12px 0' }}>{error ?? 'Loading...'}</p>;
  }

  return (
    <section>
      <Breadcrumb items={[
        { label: 'Projects', href: '/' },
        { label: project.title },
      ]} />

      <div className="page-header">
        <div className="page-header__main">
          {!editingProjectTitle ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 style={{ margin: 0 }}>{project.title}</h2>
              <button className="btn btn-ghost" onClick={startEditProjectTitle} aria-label="Edit project title">Edit</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input" value={projectTitleInput} onChange={(e) => setProjectTitleInput(e.target.value)} />
              <button className="btn btn-primary" onClick={saveProjectTitle}>Save</button>
              <button className="btn" onClick={() => setEditingProjectTitle(false)}>Cancel</button>
            </div>
          )}
          {project.description && <p>{project.description}</p>}
        </div>
        <div className="page-header__aside project-drive-status">
          <span className={`badge ${project.driveSyncStatus === 'Healthy' ? 'badge-green' : 'badge-default'}`}>
            Drive: {project.driveSyncStatus}
          </span>
          {project.driveFolderId && (
            <span className="project-drive-note">Folder linked</span>
          )}
        </div>
      </div>

      <div className="project-create">
        <div className="card">
          <form className="form-row" onSubmit={createSong}>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Song title"
              required
            />
            <button className="btn btn-primary" type="submit">Add song</button>
          </form>
          {error && <p className="form-error" style={{ marginTop: '10px' }}>{error}</p>}
        </div>
      </div>

      {project.songs.length ? (
        <ul className="song-list">
          {previewSongs.map((song) => (
            <li
              key={song.id}
              draggable
              onDragStart={(e) => onDragStart(e, song.id)}
              onDragOver={(e) => onDragOver(e, song.id)}
              onDragEnter={(e) => onDragOver(e, song.id)}
              onDragLeave={onDragLeave}
              onDrop={(e) => onDrop(e, song.id)}
              onDragEnd={onDragEnd}
              className={`song-list-item ${dragOverSongId === song.id ? 'drag-over' : ''}`}
              style={{ display: 'flex', alignItems: 'center', gap: 8 }}
            >
              <div className="drag-handle" aria-hidden>≡</div>

              <Link
                to={`/projects/${project.id}/songs/${song.id}`}
                className={`song-row ${draggedSongId === song.id ? 'dragging' : ''}`}
                aria-label={`Open song ${song.title}`}
                style={{ flex: 1 }}
              >
                <div className="song-row__main">
                  <h3 style={{ margin: 0 }}>{song.title}</h3>
                  <span className="song-row__status">{song.status}</span>
                </div>
                <div className="song-row__stats">
                  <span className="song-row__stat">{song.assetCount} {song.assetCount === 1 ? 'asset' : 'assets'}</span>
                  {song.taskOpenCount > 0 && (
                    <span className="badge badge-amber">{song.taskOpenCount} open</span>
                  )}
                </div>
              </Link>

              {!editingSongId || editingSongId !== song.id ? (
                <button className="btn btn-ghost" onClick={() => startEditSongTitle(song.id, song.title)}>Edit</button>
              ) : (
                <span style={{ display: 'flex', gap: 6 }}>
                  <input className="input" value={editingSongTitle} onChange={(e) => setEditingSongTitle(e.target.value)} />
                  <button className="btn btn-primary" onClick={() => saveSongTitle(song.id)}>Save</button>
                  <button className="btn" onClick={() => setEditingSongId(null)}>Cancel</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty-state">
          <h3>No songs yet</h3>
          <p>Create the first song in this project to start working.</p>
        </div>
      )}
    </section>
  );
}
