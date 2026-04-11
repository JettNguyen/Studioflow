import type { CreateSongRequest, ProjectDetails, SongWorkspace } from '@studioflow/shared';
import { useEffect, useState, type DragEvent, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPencil, faCheck, faXmark, faTrash } from '@fortawesome/free-solid-svg-icons';
import { apiRequest } from '../lib/api';
import { Breadcrumb } from '../components/Breadcrumb';
import './ProjectPage.css';

export function ProjectPage() {
  const navigate = useNavigate();
  const { projectId } = useParams();
  const [project, setProject] = useState<ProjectDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
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
      })
      .finally(() => setLoading(false));
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

  const toggleProjectReleased = async () => {
    if (!projectId || !project) return;
    try {
      const updated = await apiRequest<ProjectDetails>(`/projects/${projectId}`, {
        method: 'PATCH',
        body: { released: !project.released }
      });
      setProject(updated);
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
      const newTitle = editingSongTitle;
      setProject(prev => prev ? { ...prev, songs: prev.songs.map(s => s.id === songId ? { ...s, title: newTitle } : s) } : prev);
      setPreviewSongs(prev => prev.map(s => s.id === songId ? { ...s, title: newTitle } : s));
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

  const deleteSong = async (songId: string, songTitle: string) => {
    if (!window.confirm(`Delete "${songTitle}"? This will remove all its assets, notes, and tasks permanently.`)) return;
    try {
      await apiRequest(`/songs/${songId}`, { method: 'DELETE' });
      setPreviewSongs(prev => prev.filter(s => s.id !== songId));
      setProject(prev => prev ? { ...prev, songs: prev.songs.filter(s => s.id !== songId) } : prev);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to delete song');
    }
  };

  const createSong = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!projectId) {
      return;
    }

    setCreating(true);

    try {
      const song = await apiRequest<SongWorkspace>(`/songs/project/${projectId}`, {
        method: 'POST',
        body: { title } satisfies CreateSongRequest
      });

      setTitle('');
      navigate(`/projects/${projectId}/songs/${song.id}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to create song');
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <section>
        <div className="skeleton skeleton--breadcrumb" />
        <div className="skeleton skeleton--title" style={{ marginBottom: 20 }} />
        <ul className="song-list">
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="song-list-item">
              <div className="song-row song-row--skeleton">
                <div className="skeleton skeleton--line" />
                <div className="skeleton skeleton--badge" />
              </div>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  if (!project) {
    return <p style={{ color: 'var(--text-2)', padding: '12px 0' }}>{error ?? 'Unable to load project.'}</p>;
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
              <button className="btn btn-ghost btn-icon" onClick={startEditProjectTitle} aria-label="Edit project title">
                <FontAwesomeIcon icon={faPencil} />
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input" value={projectTitleInput} onChange={(e) => setProjectTitleInput(e.target.value)} />
              <button className="btn btn-primary btn-icon" onClick={saveProjectTitle} aria-label="Save">
                <FontAwesomeIcon icon={faCheck} />
              </button>
              <button className="btn btn-ghost btn-icon" onClick={() => setEditingProjectTitle(false)} aria-label="Cancel">
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
          )}
          {project.description && <p>{project.description}</p>}
        </div>
        <div className="page-header__aside project-drive-status">
          <button
            className={`btn btn-ghost btn-sm ${project.released ? 'released' : ''}`}
            type="button"
            onClick={toggleProjectReleased}
            aria-pressed={project.released}
            title={project.released ? 'Mark as unreleased' : 'Mark as released'}
          >
            {project.released ? 'Released' : 'Unreleased'}
          </button>

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
            <button className="btn btn-primary" type="submit" disabled={creating || title.trim() === ''}>
              {creating ? 'Adding…' : 'Add song'}
            </button>
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
                </div>
                <div className="song-row__stats">
                  <span className="song-row__stat">{song.assetCount} {song.assetCount === 1 ? 'asset' : 'assets'}</span>
                  <span className={`badge ${song.released ? 'badge-green' : 'badge-default'}`}>{song.released ? 'Released' : 'Unreleased'}</span>
                  {song.taskOpenCount > 0 && (
                    <span className="badge badge-amber">{song.taskOpenCount} open</span>
                  )}
                </div>
              </Link>

              {!editingSongId || editingSongId !== song.id ? (
                <button className="btn btn-ghost btn-icon" onClick={() => startEditSongTitle(song.id, song.title)} aria-label={`Edit ${song.title}`}>
                  <FontAwesomeIcon icon={faPencil} />
                </button>
              ) : (
                <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input className="input" value={editingSongTitle} onChange={(e) => setEditingSongTitle(e.target.value)} />
                  <button className="btn btn-primary btn-icon" onClick={() => saveSongTitle(song.id)} aria-label="Save">
                    <FontAwesomeIcon icon={faCheck} />
                  </button>
                  <button className="btn btn-ghost btn-icon" onClick={() => setEditingSongId(null)} aria-label="Cancel">
                    <FontAwesomeIcon icon={faXmark} />
                  </button>
                  <button className="btn btn-danger btn-icon" onClick={() => deleteSong(song.id, song.title)} aria-label={`Delete ${song.title}`}>
                    <FontAwesomeIcon icon={faTrash} />
                  </button>
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
