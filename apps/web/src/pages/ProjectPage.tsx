import type { CreateSongRequest, ProjectDetails, SongWorkspace } from '@studioflow/shared';
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPencil, faCheck, faXmark, faTrash } from '@fortawesome/free-solid-svg-icons';
import { apiRequest, apiUploadWithProgress, resolveApiUrl } from '../lib/api';
import { Breadcrumb } from '../components/Breadcrumb';
import './ProjectPage.css';

const PROJECT_ASSET_CATEGORIES: ProjectAssetCategory[] = [
  'Shot List', 'Filming Clip', 'Trailer Version', 'Trailer Audio', 'Other'
];

type ProjectAssetCategory = 'Shot List' | 'Filming Clip' | 'Trailer Version' | 'Trailer Audio' | 'Other';

type ProjectAsset = {
  id: string;
  name: string;
  type: string;
  category: ProjectAssetCategory;
  fileSizeBytes: number | null;
  isLink: boolean;
  downloadUrl: string;
  createdAt: string;
};

function fmtFileBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtFileType(type: string): string {
  if (!type) return 'File';
  if (type.startsWith('audio/')) return (type.split('/')[1] ?? 'audio').toUpperCase();
  if (type.startsWith('video/')) return (type.split('/')[1] ?? 'video').toUpperCase();
  if (type.startsWith('image/')) return (type.split('/')[1] ?? 'image').toUpperCase();
  const ext = type.split('/')[1];
  return ext ? ext.toUpperCase() : 'File';
}

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

  // Project Files (misc assets)
  const [miscAssets, setMiscAssets] = useState<ProjectAsset[]>([]);
  const [miscUploadOpen, setMiscUploadOpen] = useState(false);
  const [miscUploading, setMiscUploading] = useState(false);
  const [miscUploadProgress, setMiscUploadProgress] = useState<number | null>(null);
  const [miscAssetName, setMiscAssetName] = useState('');
  const [miscAssetCategory, setMiscAssetCategory] = useState<ProjectAssetCategory>('Other');
  const [miscSelectedFile, setMiscSelectedFile] = useState<File | null>(null);
  const [miscLinkUrl, setMiscLinkUrl] = useState('');
  const [editingMiscAssetId, setEditingMiscAssetId] = useState<string | null>(null);
  const [editMiscAssetName, setEditMiscAssetName] = useState('');
  const [editMiscAssetCategory, setEditMiscAssetCategory] = useState<ProjectAssetCategory>('Other');
  const [editMiscLinkUrl, setEditMiscLinkUrl] = useState('');
  const [savingMiscAssetEdit, setSavingMiscAssetEdit] = useState(false);
  const miscFileInputRef = useRef<HTMLInputElement | null>(null);

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
    if (!projectId) return;
    apiRequest<ProjectAsset[]>(`/projects/${projectId}/assets`)
      .then(setMiscAssets)
      .catch(() => { /* non-fatal */ });
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

  const uploadMiscAsset = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!projectId) return;

    // Shot List category → save as a link, not a file upload
    if (miscAssetCategory === 'Shot List') {
      if (!miscLinkUrl.trim()) return;
      try {
        setMiscUploading(true);
        setError(null);
        const newAsset = await apiRequest<ProjectAsset>(`/projects/${projectId}/assets/link`, {
          method: 'POST',
          body: {
            category: 'Shot List',
            linkUrl: miscLinkUrl.trim(),
            name: miscAssetName.trim() || 'Shot List'
          }
        });
        setMiscAssets(prev => [newAsset, ...prev]);
        setMiscAssetName('');
        setMiscLinkUrl('');
        setMiscUploadOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save link');
      } finally {
        setMiscUploading(false);
      }
      return;
    }

    if (!miscSelectedFile) return;
    try {
      setMiscUploading(true);
      setMiscUploadProgress(0);
      setError(null);
      const fd = new FormData();
      fd.append('file', miscSelectedFile);
      fd.append('category', miscAssetCategory);
      if (miscAssetName.trim()) fd.append('name', miscAssetName.trim());
      const newAsset = await apiUploadWithProgress<ProjectAsset>(
        `/projects/${projectId}/assets`, fd, setMiscUploadProgress
      );
      setMiscAssets(prev => [newAsset, ...prev]);
      setMiscAssetName('');
      setMiscSelectedFile(null);
      setMiscAssetCategory('Other');
      if (miscFileInputRef.current) miscFileInputRef.current.value = '';
      setMiscUploadOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setMiscUploading(false);
      setMiscUploadProgress(null);
    }
  };

  const deleteMiscAsset = async (assetId: string, assetName: string) => {
    if (!projectId || !window.confirm(`Remove "${assetName}"? This cannot be undone.`)) return;
    try {
      await apiRequest(`/projects/${projectId}/assets/${assetId}`, { method: 'DELETE' });
      setMiscAssets(prev => prev.filter(a => a.id !== assetId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove file');
    }
  };

  const startEditMiscAsset = (asset: ProjectAsset) => {
    setEditingMiscAssetId(asset.id);
    setEditMiscAssetName(asset.name);
    setEditMiscAssetCategory(asset.category);
    setEditMiscLinkUrl(asset.isLink ? asset.downloadUrl : '');
  };

  const saveMiscAsset = async (asset: ProjectAsset) => {
    if (!projectId) return;
    try {
      setSavingMiscAssetEdit(true);
      const payload: Record<string, string> = {
        name: editMiscAssetName.trim(),
        category: editMiscAssetCategory
      };
      if (asset.isLink) {
        payload.linkUrl = editMiscLinkUrl.trim();
      }
      const updated = await apiRequest<ProjectAsset>(`/projects/${projectId}/assets/${asset.id}`, {
        method: 'PATCH',
        body: payload
      });
      setMiscAssets(prev => prev.map(a => a.id === asset.id ? updated : a));
      setEditingMiscAssetId(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update project file');
    } finally {
      setSavingMiscAssetEdit(false);
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
        <div className="page-header">
          <div className="page-header__main">
            <div className="skeleton" style={{ height: 26, width: '38%', borderRadius: 'var(--r-2)', marginBottom: 8 }} />
            <div className="skeleton" style={{ height: 13, width: '20%', borderRadius: 'var(--r-1)' }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div className="skeleton skeleton--badge" style={{ width: 84, height: 28 }} />
            <div className="skeleton skeleton--badge" style={{ width: 72, height: 28 }} />
          </div>
        </div>

        <div className="project-create">
          <div className="card">
            <div className="skeleton" style={{ height: 38, borderRadius: 'var(--r-2)' }} />
          </div>
        </div>

        <ul className="song-list">
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="song-list-item" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 26, flexShrink: 0 }} />
              <div className="song-row song-row--skeleton" style={{ flex: 1 }}>
                <div className="skeleton skeleton--line" style={{ width: `${45 + (i % 3) * 15}%` }} />
                <div style={{ display: 'flex', gap: 10 }}>
                  <div className="skeleton skeleton--badge" />
                  <div className="skeleton skeleton--badge" />
                </div>
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

      <h3 className="section-heading">Songs</h3>

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

      {/* ── Project Files (misc assets) ──────────────────────────────── */}
      <div className="project-files">
        <div className="project-files__header">
          <h3 className="section-heading" style={{ margin: 0 }}>Project Files</h3>
          <p className="project-files__sub">Non-song assets — trailer clips, shot lists, behind-the-scenes footage, etc.</p>
          <button
            className={`upload-toggle${miscUploadOpen ? ' upload-toggle--open' : ''}`}
            type="button"
            onClick={() => setMiscUploadOpen(o => !o)}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M5 1V9M1 5H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Upload file
            <svg className="upload-toggle__chevron" width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true">
              <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        {miscUploadOpen && (
          <div className="card misc-upload-card">
            <form className="form-stack" onSubmit={uploadMiscAsset}>
              <div className="form-row">
                <input
                  className="input"
                  value={miscAssetName}
                  onChange={e => setMiscAssetName(e.target.value)}
                  placeholder={miscAssetCategory === 'Shot List' ? 'Label (optional)' : 'File name (optional)'}
                />
                <select
                  className="select"
                  value={miscAssetCategory}
                  onChange={e => {
                    setMiscAssetCategory(e.target.value as ProjectAssetCategory);
                    setMiscSelectedFile(null);
                    setMiscLinkUrl('');
                    if (miscFileInputRef.current) miscFileInputRef.current.value = '';
                  }}
                >
                  {PROJECT_ASSET_CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              {miscAssetCategory === 'Shot List' ? (
                /* Link input for Shot List */
                <div className="form-row">
                  <input
                    className="input"
                    type="url"
                    value={miscLinkUrl}
                    onChange={e => setMiscLinkUrl(e.target.value)}
                    placeholder="https://docs.google.com/document/d/…"
                    required
                  />
                  <button
                    className="btn btn-primary btn-sm"
                    type="submit"
                    disabled={miscUploading || !miscLinkUrl.trim()}
                    style={{ flexShrink: 0 }}
                  >
                    {miscUploading ? 'Saving…' : 'Save link'}
                  </button>
                </div>
              ) : (
                /* File picker for all other categories */
                <div className="file-picker-row">
                  <label className="btn btn-ghost btn-sm file-picker-label" htmlFor="misc-file-input">
                    Choose file
                  </label>
                  <span className="file-picker-name">{miscSelectedFile?.name ?? 'No file selected'}</span>
                  <input
                    id="misc-file-input"
                    ref={miscFileInputRef}
                    className="file-picker-hidden"
                    type="file"
                    onChange={e => setMiscSelectedFile(e.target.files?.[0] ?? null)}
                    required
                  />
                  <button
                    className="btn btn-primary btn-sm"
                    type="submit"
                    disabled={miscUploading || !miscSelectedFile}
                    style={{ marginLeft: 'auto' }}
                  >
                    {miscUploading ? 'Uploading…' : 'Upload'}
                  </button>
                </div>
              )}

              {miscUploading && miscUploadProgress !== null && (
                <div className="upload-progress">
                  <div className="upload-progress__bar" style={{ width: `${miscUploadProgress}%` }} />
                  <span className="upload-progress__label">{miscUploadProgress}%</span>
                </div>
              )}
            </form>
          </div>
        )}

        {miscAssets.length > 0 && (
          <ul className="misc-asset-list">
            {miscAssets.map(asset => (
              <li key={asset.id} className="misc-asset-row">
                {asset.isLink && (
                  <svg className="misc-asset-row__link-icon" width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
                    <rect width="20" height="20" rx="3" fill="#4285F4" opacity="0.15"/>
                    <path d="M5 5h6l4 4v6a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z" stroke="#4285F4" strokeWidth="1.2" fill="none"/>
                    <path d="M11 5v4h4" stroke="#4285F4" strokeWidth="1.2" strokeLinejoin="round" fill="none"/>
                    <path d="M7 10h6M7 12h6M7 14h4" stroke="#4285F4" strokeWidth="1" strokeLinecap="round"/>
                  </svg>
                )}
                <div className="misc-asset-row__info">
                  <span className="misc-asset-row__name">{asset.name}</span>
                  <div className="misc-asset-row__meta">
                    <span className="badge badge-default">{asset.category}</span>
                    {!asset.isLink && asset.type && <span className="misc-asset-row__type">{fmtFileType(asset.type)}</span>}
                    {!asset.isLink && asset.fileSizeBytes && (
                      <span className="misc-asset-row__size">{fmtFileBytes(asset.fileSizeBytes)}</span>
                    )}
                    {asset.isLink && <span className="misc-asset-row__type">Google Doc</span>}
                  </div>
                </div>

                <div className="misc-asset-row__actions">
                  <a
                    className="btn btn-ghost btn-icon"
                    href={asset.isLink ? asset.downloadUrl : resolveApiUrl(asset.downloadUrl)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={asset.isLink ? 'Open link' : 'Download file'}
                    title={asset.isLink ? 'Open link' : 'Download file'}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                      {asset.isLink ? (
                        <path d="M4 2.5h5.5V8M9.5 2.5 2.5 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                      ) : (
                        <path d="M6 1.5v6M3.5 5.5 6 8l2.5-2.5M2 9.5h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                      )}
                    </svg>
                  </a>
                  <button
                    className="btn btn-ghost btn-icon"
                    type="button"
                    onClick={() => startEditMiscAsset(asset)}
                    aria-label="Edit project file"
                    title="Edit"
                  >
                    <FontAwesomeIcon icon={faPencil} />
                  </button>
                  <button
                    className="btn btn-danger btn-icon"
                    type="button"
                    onClick={() => deleteMiscAsset(asset.id, asset.name)}
                    aria-label="Remove project file"
                    title="Remove"
                  >
                    <FontAwesomeIcon icon={faTrash} />
                  </button>
                </div>

                {editingMiscAssetId === asset.id && (
                  <div className="misc-asset-edit-form">
                    <div className="form-row">
                      <input
                        className="input"
                        value={editMiscAssetName}
                        onChange={e => setEditMiscAssetName(e.target.value)}
                        placeholder="Asset name"
                      />
                      <select
                        className="select"
                        value={editMiscAssetCategory}
                        onChange={e => setEditMiscAssetCategory(e.target.value as ProjectAssetCategory)}
                      >
                        {PROJECT_ASSET_CATEGORIES.map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                      {asset.isLink && (
                        <input
                          className="input"
                          type="url"
                          value={editMiscLinkUrl}
                          onChange={e => setEditMiscLinkUrl(e.target.value)}
                          placeholder="https://docs.google.com/document/d/..."
                        />
                      )}
                      <button
                        className="btn btn-primary btn-icon"
                        type="button"
                        onClick={() => saveMiscAsset(asset)}
                        disabled={savingMiscAssetEdit || !editMiscAssetName.trim() || (asset.isLink && !editMiscLinkUrl.trim())}
                        aria-label="Save"
                        title="Save"
                      >
                        <FontAwesomeIcon icon={faCheck} />
                      </button>
                      <button
                        className="btn btn-ghost btn-icon"
                        type="button"
                        onClick={() => setEditingMiscAssetId(null)}
                        aria-label="Cancel"
                        title="Cancel"
                      >
                        <FontAwesomeIcon icon={faXmark} />
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {miscAssets.length === 0 && !miscUploadOpen && (
          <p className="misc-empty">No project files yet. Upload trailer clips, shot lists, and other assets here.</p>
        )}
      </div>
    </section>
  );
}
