import type {
  AssetCategory,
  CreateAssetNoteRequest,
  CreateNoteRequest,
  CreateTaskRequest,
  SongAsset,
  SongTaskStatus,
  SongWorkspace,
  UpdateTaskStatusRequest
} from '@studioflow/shared';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { apiRequest, apiUploadWithProgress, resolveApiUrl } from '../lib/api';
import { analyzeAudioFile, type AudioFeatures } from '../lib/audioAnalysis';
import { Breadcrumb } from '../components/Breadcrumb';
import { WaveformPlayer } from '../components/WaveformPlayer';
import { VideoThumbnail } from '../components/VideoThumbnail';
import './SongWorkspacePage.css';

type SongWorkspaceWithLyrics = SongWorkspace & { lyrics?: string | null; shotListUrl?: string | null };

const VERSIONED_CATEGORIES: AssetCategory[] = ['Song Audio', 'Videos', 'Beat', 'Stems'];
const CATEGORY_ORDER: AssetCategory[] = ['Song Audio', 'Beat', 'Stems', 'Videos', 'Social Media Content'];

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtBytes(bytes: number | null): string | null {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtType(type: string): string {
  if (type.startsWith('audio/')) return (type.split('/')[1] ?? 'audio').toUpperCase();
  if (type.startsWith('video/')) return (type.split('/')[1] ?? 'video').toUpperCase();
  return type;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hrs < 24) return `${hrs}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtAbsolute(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });
}

async function readFileDuration(file: File): Promise<string | null> {
  const kind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : null;
  if (!kind) return null;
  const url = URL.createObjectURL(file);
  try {
    const el = document.createElement(kind);
    el.preload = 'metadata';
    return await new Promise<string | null>((resolve) => {
      el.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        const s = Math.round(el.duration);
        resolve(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
      };
      el.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      el.src = url;
    });
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SongWorkspacePage() {
  const { projectId, songId } = useParams();
  const [song, setSong] = useState<SongWorkspaceWithLyrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Upload form
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadMode, setUploadMode] = useState<'file' | 'shotlist'>('file');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [assetName, setAssetName] = useState('');
  const [assetCategory, setAssetCategory] = useState<AssetCategory>('Song Audio');
  const [assetVersionGroup, setAssetVersionGroup] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [detectedFeatures, setDetectedFeatures] = useState<AudioFeatures | null>(null);

  // Shot list
  const [shotListInput, setShotListInput] = useState('');
  const [savingShotList, setSavingShotList] = useState(false);
  const [shotListEmbedOpen, setShotListEmbedOpen] = useState(false);

  // Key/BPM inline edit
  const [editingMeta, setEditingMeta] = useState(false);
  const [editKey, setEditKey] = useState('');
  const [editBpm, setEditBpm] = useState('');

  // Notes + tasks
  const [noteBody, setNoteBody] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [lyricsDraft, setLyricsDraft] = useState('');
  const [savingLyrics, setSavingLyrics] = useState(false);

  // Per-asset notes
  const [assetNoteDrafts, setAssetNoteDrafts] = useState<Record<string, string>>({});
  const [openAssetNotes, setOpenAssetNotes] = useState<Set<string>>(new Set());
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [editAssetName, setEditAssetName] = useState('');
  const [editAssetCategory, setEditAssetCategory] = useState<AssetCategory>('Song Audio');
  const [editAssetVersionGroup, setEditAssetVersionGroup] = useState('');
  const [savingAssetEdit, setSavingAssetEdit] = useState(false);

  // Version selection
  const [selectedVersionByGroup, setSelectedVersionByGroup] = useState<Record<string, string>>({});

  // Video modal — no auto-fullscreen, user can fullscreen manually from controls
  const [activeVideoAsset, setActiveVideoAsset] = useState<SongAsset | null>(null);
  const activeVideoUrl = useMemo(
    () => activeVideoAsset?.streamUrl ? resolveApiUrl(activeVideoAsset.streamUrl) : null,
    [activeVideoAsset]
  );

  // ── Data ──────────────────────────────────────────────────────────────────

  const groupedSections = useMemo(() => {
    if (!song) return [] as Array<{ category: AssetCategory; groups: Array<{ groupKey: string; versions: SongAsset[] }> }>;
    return VERSIONED_CATEGORIES.map(category => {
      const assets = song.assets.filter(a => a.category === category);
      const map = new Map<string, SongAsset[]>();
      for (const asset of assets) {
        const existing = map.get(asset.versionGroup) ?? [];
        existing.push(asset);
        map.set(asset.versionGroup, existing);
      }
      const groups = Array.from(map.entries())
        .map(([groupKey, versions]) => ({
          groupKey,
          versions: versions.sort((a, b) => b.versionNumber - a.versionNumber)
        }))
        .sort((a, b) => {
          const al = a.versions[0];
          const bl = b.versions[0];
          return new Date(bl.createdAt).getTime() - new Date(al.createdAt).getTime();
        });
      return { category, groups };
    });
  }, [song]);

  const smcAssets = useMemo(() => {
    if (!song) return [];
    return song.assets
      .filter(a => a.category === 'Social Media Content')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [song]);

  useEffect(() => {
    setSelectedVersionByGroup(current => {
      const next = { ...current };
      for (const section of groupedSections) {
        for (const group of section.groups) {
          const key = `${section.category}::${group.groupKey}`;
          if (!next[key]) next[key] = group.versions[0]?.id ?? '';
        }
      }
      return next;
    });
  }, [groupedSections]);

  // ── Audio analysis ────────────────────────────────────────────────────────

  useEffect(() => {
    const singleFile = selectedFiles.length === 1 ? selectedFiles[0] : null;
    if (!singleFile || assetCategory !== 'Song Audio') {
      setDetectedFeatures(null);
      return;
    }
    let cancelled = false;
    setAnalyzing(true);
    setDetectedFeatures(null);
    analyzeAudioFile(singleFile).then(features => {
      if (!cancelled) { setDetectedFeatures(features); setAnalyzing(false); }
    });
    return () => { cancelled = true; setAnalyzing(false); };
  }, [selectedFiles, assetCategory]);

  // ── Fetch ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!songId) return;
    apiRequest<SongWorkspaceWithLyrics>(`/songs/${songId}`)
      .then(s => {
        setSong(s);
        setLyricsDraft(s.lyrics ?? '');
        setShotListInput(s.shotListUrl ?? '');
        setError(null);
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Unable to load song'));
  }, [songId]);


  const refreshSong = async () => {
    if (!songId) return;
    const s = await apiRequest<SongWorkspaceWithLyrics>(`/songs/${songId}`);
    setSong(s);
    setLyricsDraft(s.lyrics ?? '');
    setShotListInput(s.shotListUrl ?? '');
  };

  // ── Actions ───────────────────────────────────────────────────────────────

  const uploadAsset = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!songId || selectedFiles.length === 0) { setError('Please choose a file.'); return; }
    const isSingle = selectedFiles.length === 1;
    try {
      setUploading(true);
      setError(null);
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        setUploadProgress(0);
        const fd = new FormData();
        fd.append('file', file);
        fd.append('category', assetCategory);
        if (isSingle && assetName.trim()) fd.append('name', assetName.trim());
        if (assetVersionGroup.trim()) fd.append('versionGroup', assetVersionGroup.trim());
        const dur = await readFileDuration(file);
        if (dur) fd.append('duration', dur);
        if (isSingle && assetCategory === 'Song Audio' && detectedFeatures) {
          if (detectedFeatures.key) fd.append('detectedKey', detectedFeatures.key);
          if (detectedFeatures.bpm !== null) fd.append('detectedBpm', String(detectedFeatures.bpm));
        }
        await apiUploadWithProgress<SongAsset>(
          `/songs/${songId}/assets`, fd,
          pct => setUploadProgress(Math.round(((i + pct / 100) / selectedFiles.length) * 100))
        );
      }
      setAssetName(''); setAssetVersionGroup(''); setSelectedFiles([]); setDetectedFeatures(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await refreshSong();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const saveMeta = async () => {
    if (!songId) return;
    try {
      const bpmNum = editBpm.trim() ? parseInt(editBpm, 10) : null;
      const updated = await apiRequest<SongWorkspace>(`/songs/${songId}`, {
        method: 'PATCH',
        body: {
          key: editKey.trim() || null,
          bpm: bpmNum && Number.isFinite(bpmNum) ? bpmNum : null,
        }
      });
      setSong(updated);
      setEditingMeta(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
  };

  const saveLyrics = async () => {
    if (!songId) return;
    try {
      setSavingLyrics(true);
      const updated = await apiRequest<SongWorkspaceWithLyrics>(`/songs/${songId}`, {
        method: 'PATCH',
        body: {
          lyrics: lyricsDraft.trim().length ? lyricsDraft : null,
        }
      });
      setSong(updated);
      setLyricsDraft(updated.lyrics ?? '');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save lyrics');
    } finally {
      setSavingLyrics(false);
    }
  };

  const toggleSongReleased = async () => {
    if (!song || !songId) return;
    try {
      const updated = await apiRequest<SongWorkspace>(`/songs/${songId}`, {
        method: 'PATCH',
        body: { released: !song.released }
      });
      setSong(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update release state');
    }
  };

  const startEditMeta = () => {
    setEditKey(song?.key ?? '');
    setEditBpm(song?.bpm?.toString() ?? '');
    setEditingMeta(true);
  };

  const createNote = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!songId || !song) return;
    try {
      const note = await apiRequest<SongWorkspace['notes'][number]>(`/songs/${songId}/notes`, {
        method: 'POST', body: { body: noteBody } satisfies CreateNoteRequest
      });
      setSong({ ...song, notes: [note, ...song.notes] });
      setNoteBody(''); setError(null);
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to add note'); }
  };

  const createTask = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!songId || !song) return;
    try {
      const task = await apiRequest<SongWorkspace['tasks'][number]>(`/songs/${songId}/tasks`, {
        method: 'POST', body: { title: taskTitle } satisfies CreateTaskRequest
      });
      setSong({ ...song, tasks: [task, ...song.tasks] });
      setTaskTitle(''); setError(null);
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to add task'); }
  };

  const deleteNote = async (noteId: string) => {
    if (!songId || !song) return;
    try {
      await apiRequest(`/songs/${songId}/notes/${noteId}`, { method: 'DELETE' });
      setSong({ ...song, notes: song.notes.filter(n => n.id !== noteId) });
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to delete note'); }
  };

  const deleteTask = async (taskId: string) => {
    if (!songId || !song) return;
    try {
      await apiRequest(`/songs/${songId}/tasks/${taskId}`, { method: 'DELETE' });
      setSong({ ...song, tasks: song.tasks.filter(t => t.id !== taskId) });
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to delete task'); }
  };

  const updateTaskStatus = async (taskId: string, status: SongTaskStatus) => {
    if (!songId || !song) return;
    try {
      const updated = await apiRequest<SongWorkspace['tasks'][number]>(
        `/songs/${songId}/tasks/${taskId}`,
        { method: 'PATCH', body: { status } satisfies UpdateTaskStatusRequest }
      );
      setSong({ ...song, tasks: song.tasks.map(t => t.id === taskId ? updated : t) });
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to update task'); }
  };

  const removeAsset = async (asset: SongAsset) => {
    if (!song || !window.confirm(`Remove "${asset.name}"? This cannot be undone.`)) return;
    try {
      await apiRequest(`/assets/${asset.id}`, { method: 'DELETE' });
      setSong({ ...song, assets: song.assets.filter(a => a.id !== asset.id) });
      if (activeVideoAsset?.id === asset.id) setActiveVideoAsset(null);
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to remove asset'); }
  };

  const addAssetNote = async (asset: SongAsset) => {
    const body = (assetNoteDrafts[asset.id] ?? '').trim();
    if (!body || !song) return;
    try {
      const note = await apiRequest<SongAsset['notes'][number]>(`/assets/${asset.id}/notes`, {
        method: 'POST', body: { body } satisfies CreateAssetNoteRequest
      });
      setSong({ ...song, assets: song.assets.map(a => a.id === asset.id ? { ...a, notes: [note, ...a.notes] } : a) });
      setAssetNoteDrafts(d => ({ ...d, [asset.id]: '' }));
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to add note'); }
  };

  const saveShotList = async () => {
    if (!songId) return;
    const url = shotListInput.trim() || null;
    try {
      setSavingShotList(true);
      const updated = await apiRequest<SongWorkspaceWithLyrics>(`/songs/${songId}`, {
        method: 'PATCH',
        body: { shotListUrl: url }
      });
      setSong(updated);
      setShotListInput(updated.shotListUrl ?? '');
      setUploadOpen(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save shot list');
    } finally {
      setSavingShotList(false);
    }
  };

  const startEditAsset = (asset: SongAsset) => {
    setEditingAssetId(asset.id);
    setEditAssetName(asset.name);
    setEditAssetCategory(asset.category);
    setEditAssetVersionGroup(asset.versionGroup);
  };

  const saveAssetEdit = async (assetId: string) => {
    try {
      setSavingAssetEdit(true);
      await apiRequest(`/assets/${assetId}`, {
        method: 'PATCH',
        body: {
          name: editAssetName.trim(),
          category: editAssetCategory,
          versionGroup: editAssetVersionGroup.trim()
        }
      });
      await refreshSong();
      setEditingAssetId(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update asset');
    } finally {
      setSavingAssetEdit(false);
    }
  };

  const removeShotList = async () => {
    if (!songId || !window.confirm('Remove the shot list link from this song?')) return;
    try {
      const updated = await apiRequest<SongWorkspaceWithLyrics>(`/songs/${songId}`, {
        method: 'PATCH',
        body: { shotListUrl: null }
      });
      setSong(updated);
      setShotListInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove shot list');
    }
  };

  const toggleAssetNotes = (assetId: string) => {
    setOpenAssetNotes(prev => {
      const next = new Set(prev);
      next.has(assetId) ? next.delete(assetId) : next.add(assetId);
      return next;
    });
  };

  // ── Render helpers ────────────────────────────────────────────────────────

  const renderMetaTags = (asset: SongAsset) => {
    const tags: string[] = [];
    if (asset.duration) tags.push(asset.duration);
    if (asset.sampleRateHz) tags.push(`${asset.sampleRateHz} Hz`);
    if (asset.bitrateKbps) tags.push(`${asset.bitrateKbps} kbps`);
    if (asset.channels) tags.push(asset.channels === 1 ? 'Mono' : asset.channels === 2 ? 'Stereo' : `${asset.channels}ch`);
    if (asset.codec) tags.push(asset.codec);
    if (asset.container) tags.push(asset.container);
    const size = fmtBytes(asset.fileSizeBytes);
    if (size) tags.push(size);
    if (!tags.length) tags.push(fmtType(asset.type));
    return tags;
  };

  const renderVersionedCard = (composedKey: string, group: { groupKey: string; versions: SongAsset[] }) => {
    const selectedId = selectedVersionByGroup[composedKey] || group.versions[0].id;
    const asset = group.versions.find(v => v.id === selectedId) || group.versions[0];
    const notesOpen = openAssetNotes.has(asset.id);
    const metaTags = renderMetaTags(asset);
    const isImage = asset.mediaKind === 'other' && asset.type.startsWith('image/');

    return (
      <div className="asset-card" key={composedKey}>

        {/* Video thumbnail */}
        {asset.mediaKind === 'video' && asset.streamUrl && (
          <VideoThumbnail
            src={resolveApiUrl(asset.streamUrl)}
            onClick={() => setActiveVideoAsset(asset)}
          />
        )}

        {/* Image preview */}
        {isImage && asset.streamUrl && (
          <div className="asset-img-preview">
            <img
              src={resolveApiUrl(asset.streamUrl)}
              alt={asset.name}
              className="asset-img"
              loading="lazy"
            />
          </div>
        )}

        {/* Header */}
        <div className="asset-card__head">
          <div className="asset-card__title-row">
            <span className="asset-card__name">{asset.name}</span>
            <div className="asset-card__badges">
              <span className="badge badge-default">v{asset.versionNumber}</span>
              {group.versions.length > 1 && (
                <span className="badge badge-default">{group.versions.length} versions</span>
              )}
            </div>
          </div>
        </div>

        {/* Waveform player for audio */}
        {asset.mediaKind === 'audio' && asset.streamUrl && (
          <WaveformPlayer src={resolveApiUrl(asset.streamUrl)} />
        )}

        {/* Meta tags */}
        <div className="asset-metadata">
          {metaTags.map(tag => (
            <span key={tag} className="asset-meta-tag">{tag}</span>
          ))}
          <span className="asset-meta-tag asset-meta-tag--time" title={fmtAbsolute(asset.createdAt)}>
            {timeAgo(asset.createdAt)}
          </span>
        </div>

        {/* Version history */}
        {group.versions.length > 1 && (
          <div className="asset-history">
            <span className="asset-history__label">Version</span>
            <select
              className="select"
              value={asset.id}
              onChange={e => setSelectedVersionByGroup(cur => ({ ...cur, [composedKey]: e.target.value }))}
            >
              {group.versions.map(v => (
                <option key={v.id} value={v.id}>
                  v{v.versionNumber} — {new Date(v.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Actions */}
        <div className="asset-actions">
          <button
            className="btn btn-ghost btn-icon"
            type="button"
            onClick={() => startEditAsset(asset)}
            aria-label="Edit asset"
            title="Edit asset"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M8.5 1.5l2 2L4 10H2V8L8.5 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            </svg>
          </button>
          {asset.mediaKind === 'video' && asset.streamUrl && (
            <button
              className="btn btn-ghost btn-icon"
              type="button"
              onClick={() => setActiveVideoAsset(asset)}
              aria-label="Play video"
              title="Play video"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M4 2.5v7l5-3.5-5-3.5Z" fill="currentColor"/>
              </svg>
            </button>
          )}
          {asset.downloadUrl && (
            <a
              className="asset-download-link btn-icon"
              href={resolveApiUrl(asset.downloadUrl)}
              target="_blank"
              rel="noreferrer"
              aria-label="Download"
              title="Download"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M6 1.5v6M3.5 5.5 6 8l2.5-2.5M2 9.5h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </a>
          )}
          <button
            className="btn btn-danger btn-icon"
            type="button"
            onClick={() => removeAsset(asset)}
            aria-label="Remove asset"
            title="Remove asset"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M2.5 3h7M4.5 3V2h3v1M5 5v4M7 5v4M3.5 3l.4 6.2a1 1 0 001 .8h1.2a1 1 0 001-.8L8 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button
            className={`btn btn-ghost btn-icon asset-notes-toggle${notesOpen ? ' active' : ''}`}
            type="button"
            onClick={() => toggleAssetNotes(asset.id)}
            aria-label={asset.notes.length > 0 ? `Notes (${asset.notes.length})` : 'Notes'}
            title={asset.notes.length > 0 ? `Notes (${asset.notes.length})` : 'Notes'}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M2 2.5h8v5.5H5l-2.5 2v-2H2v-5.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        {editingAssetId === asset.id && (
          <div className="asset-edit-form">
            <div className="form-row">
              <input
                className="input"
                value={editAssetName}
                onChange={e => setEditAssetName(e.target.value)}
                placeholder="Asset name"
              />
              <select
                className="select"
                value={editAssetCategory}
                onChange={e => setEditAssetCategory(e.target.value as AssetCategory)}
              >
                {CATEGORY_ORDER.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
              <input
                className="input"
                value={editAssetVersionGroup}
                onChange={e => setEditAssetVersionGroup(e.target.value)}
                placeholder="Version group"
              />
              <button
                className="btn btn-primary btn-icon"
                type="button"
                onClick={() => saveAssetEdit(asset.id)}
                disabled={savingAssetEdit || !editAssetName.trim()}
                aria-label="Save asset"
                title="Save"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M2 6.5 4.5 9 10 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <button
                className="btn btn-ghost btn-icon"
                type="button"
                onClick={() => setEditingAssetId(null)}
                aria-label="Cancel"
                title="Cancel"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Collapsible notes */}
        {notesOpen && (
          <div className="asset-notes-area">
            <div className="form-stack">
              <textarea
                className="textarea"
                value={assetNoteDrafts[asset.id] ?? ''}
                onChange={e => setAssetNoteDrafts(d => ({ ...d, [asset.id]: e.target.value }))}
                placeholder="Notes for this version..."
                style={{ minHeight: '60px' }}
              />
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => addAssetNote(asset)}
              >
                Add note
              </button>
            </div>
            {asset.notes.length > 0 && (
              <ul className="note-list">
                {asset.notes.map(note => (
                  <li key={note.id} className="note-item">
                    <div className="note-item__meta">
                      <span className="note-item__author">{note.author}</span>
                      <time className="note-item__time" dateTime={note.createdAt} title={fmtAbsolute(note.createdAt)}>
                        {timeAgo(note.createdAt)}
                      </time>
                    </div>
                    <p className="note-item__body">{note.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Loading / error ───────────────────────────────────────────────────────

  if (!song) {
    if (error) return <p style={{ color: 'var(--text-2)', padding: '12px 0' }}>{error}</p>;
    return (
      <section className="workspace">
        <div className="workspace-main">
          {/* Song header ghost */}
          <div className="song-header">
            <div style={{ flex: 1 }}>
              <div className="skeleton" style={{ height: 24, width: '42%', borderRadius: 'var(--r-2)', marginBottom: 10 }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <div className="skeleton skeleton--badge" style={{ width: 56 }} />
                <div className="skeleton skeleton--badge" style={{ width: 68 }} />
              </div>
            </div>
            <div className="skeleton skeleton--badge" style={{ width: 84, height: 28 }} />
          </div>

          {/* Upload toggle ghost */}
          <div className="skeleton" style={{ height: 38, borderRadius: 'var(--r-2)' }} />

          {/* Asset section ghost */}
          <div className="asset-section">
            <div className="skeleton" style={{ height: 14, width: 82, borderRadius: 'var(--r-1)', marginBottom: 12 }} />
            <div className="asset-grid">
              {[0, 1].map(i => (
                <div key={i} className="skeleton" style={{ height: 148, borderRadius: 'var(--r-3)' }} />
              ))}
            </div>
          </div>

          <div className="asset-section">
            <div className="skeleton" style={{ height: 14, width: 48, borderRadius: 'var(--r-1)', marginBottom: 12 }} />
            <div className="asset-grid">
              <div className="skeleton" style={{ height: 148, borderRadius: 'var(--r-3)' }} />
            </div>
          </div>
        </div>

        <div className="sidebar">
          <div className="skeleton" style={{ height: 180, borderRadius: 'var(--r-3)' }} />
          <div className="skeleton" style={{ height: 140, borderRadius: 'var(--r-3)' }} />
          <div className="skeleton" style={{ height: 220, borderRadius: 'var(--r-3)' }} />
        </div>
      </section>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <>
      <Breadcrumb items={[
        { label: 'Projects', href: '/' },
        { label: song.projectTitle || 'Project', href: projectId ? `/projects/${projectId}` : undefined },
        { label: song.title },
      ]} />

      <section className="workspace">

      {/* ── Main column ──────────────────────────────────────────────── */}
      <div className="workspace-main">

        {/* Song header */}
        <div className="song-header">
          <div>
            <h2>{song.title}</h2>

            {/* Key / BPM — view mode */}
            {!editingMeta && (
              <div className="song-meta">
                {song.key && <span className="song-meta__item">{song.key}</span>}
                {song.bpm && <span className="song-meta__item">{song.bpm} BPM</span>}
                {!song.key && !song.bpm && (
                  <span className="song-meta__item song-meta__item--muted">No key/BPM</span>
                )}
                <button
                  className="song-meta__edit-btn"
                  type="button"
                  onClick={startEditMeta}
                  aria-label="Edit key and BPM"
                >
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                    <path d="M7.5 1.5l2 2L3 10H1V8L7.5 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
            )}

            {/* Key / BPM — edit mode */}
            {editingMeta && (
              <div className="song-meta-edit">
                <input
                  className="input song-meta-edit__input"
                  value={editKey}
                  onChange={e => setEditKey(e.target.value)}
                  placeholder="Key (e.g. Am, F#)"
                  aria-label="Key"
                />
                <input
                  className="input song-meta-edit__input"
                  type="number"
                  min={40}
                  max={400}
                  value={editBpm}
                  onChange={e => setEditBpm(e.target.value)}
                  placeholder="BPM"
                  aria-label="BPM"
                />
                <button className="btn btn-primary btn-sm" type="button" onClick={saveMeta}>Save</button>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => setEditingMeta(false)}>Cancel</button>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              className={`btn btn-ghost btn-sm ${song.released ? 'released' : ''}`}
              type="button"
              onClick={toggleSongReleased}
              aria-pressed={song.released}
              title={song.released ? 'Mark as unreleased' : 'Mark as released'}
            >
              {song.released ? 'Released' : 'Unreleased'}
            </button>
            <span className="badge badge-default">{song.status}</span>
          </div>
        </div>

        {/* Upload form — collapsible */}
        <div className="upload-section">
          <button
            className={`upload-toggle${uploadOpen ? ' upload-toggle--open' : ''}`}
            type="button"
            onClick={() => setUploadOpen(o => !o)}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M5 1V9M1 5H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Upload file
            <svg className="upload-toggle__chevron" width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true">
              <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          {uploadOpen && (
            <div className="card upload-form-card">
              <div className="upload-mode-row">
                <label className="field-label" htmlFor="upload-mode-select">Upload mode</label>
                <select
                  id="upload-mode-select"
                  className="select"
                  value={uploadMode}
                  onChange={e => setUploadMode(e.target.value as 'file' | 'shotlist')}
                >
                  <option value="file">File Upload</option>
                  <option value="shotlist">Shot List Link</option>
                </select>
              </div>

              {uploadMode === 'file' ? (
                <form className="form-stack" onSubmit={uploadAsset}>
                  <div className="form-row">
                    {selectedFiles.length <= 1 && (
                      <input className="input" value={assetName} onChange={e => setAssetName(e.target.value)} placeholder="Asset name (optional)" />
                    )}
                    <select className="select" value={assetCategory} onChange={e => setAssetCategory(e.target.value as AssetCategory)}>
                      {CATEGORY_ORDER.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                    <input className="input" value={assetVersionGroup} onChange={e => setAssetVersionGroup(e.target.value)} placeholder="Version group (optional)" />
                  </div>
                  <div className="file-picker-row">
                    <label className="btn btn-ghost btn-sm file-picker-label" htmlFor="asset-file-input">Choose files</label>
                    <span className="file-picker-name">
                      {selectedFiles.length === 0
                        ? 'No files selected'
                        : selectedFiles.length === 1
                          ? selectedFiles[0].name
                          : `${selectedFiles.length} files selected`}
                    </span>
                    <input
                      id="asset-file-input"
                      ref={fileInputRef}
                      className="file-picker-hidden"
                      type="file"
                      multiple
                      onChange={e => setSelectedFiles(Array.from(e.target.files ?? []))}
                      required
                    />
                    <button className="btn btn-primary btn-sm" type="submit" disabled={uploading || selectedFiles.length === 0} style={{ marginLeft: 'auto' }}>
                      {uploading ? 'Uploading…' : 'Upload'}
                    </button>
                  </div>
                  {assetCategory === 'Song Audio' && selectedFiles.length === 1 && (
                    <div className="analysis-status">
                      {analyzing ? (
                        <span className="analysis-status__scanning">Analyzing audio…</span>
                      ) : detectedFeatures ? (
                        <span className="analysis-status__result">
                          Detected:{' '}
                          {[detectedFeatures.key, detectedFeatures.bpm != null ? `${detectedFeatures.bpm} BPM` : null]
                            .filter(Boolean).join(' · ') || 'No key/BPM detected'}
                        </span>
                      ) : null}
                    </div>
                  )}
                  {uploading && uploadProgress !== null && (
                    <div className="upload-progress">
                      <div className="upload-progress__bar" style={{ width: `${uploadProgress}%` }} />
                      <span className="upload-progress__label">{uploadProgress}%</span>
                    </div>
                  )}
                  {error && <p className="form-error">{error}</p>}
                </form>
              ) : (
                <div className="form-stack">
                  <p className="shot-list-hint">
                    Link a Google Doc as a collaborative shot list for this song.
                    Anyone with the link can view or edit it directly in Google Docs.
                  </p>
                  <div className="form-row">
                    <input
                      className="input"
                      type="url"
                      value={shotListInput}
                      onChange={e => setShotListInput(e.target.value)}
                      placeholder="https://docs.google.com/document/d/…"
                    />
                    <button
                      className="btn btn-primary btn-sm"
                      type="button"
                      onClick={saveShotList}
                      disabled={savingShotList || !shotListInput.trim()}
                      style={{ flexShrink: 0 }}
                    >
                      {savingShotList ? 'Saving…' : song.shotListUrl ? 'Update' : 'Save'}
                    </button>
                    {song.shotListUrl && (
                      <button
                        className="btn btn-danger btn-sm"
                        type="button"
                        onClick={removeShotList}
                        style={{ flexShrink: 0 }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Shot list display — always visible when linked */}
        {/* Asset sections */}
        <div className="asset-sections">
          {CATEGORY_ORDER.map(category => {
            if (category === 'Social Media Content') {
              if (!smcAssets.length) return null;
              return (
                <div key="Social Media Content" className="asset-section">
                  <p className="asset-section__label">
                    Social Media Content
                    <span className="asset-section__count">{smcAssets.length}</span>
                  </p>
                  <div className="smc-list">
                    {smcAssets.map(asset => {
                      const isImg = asset.mediaKind === 'other' && asset.type.startsWith('image/');
                      return (
                        <div key={asset.id} className="smc-row">
                          {/* Thumbnail / icon */}
                          {asset.mediaKind === 'video' && asset.streamUrl ? (
                            <div className="smc-row__thumb">
                              <VideoThumbnail
                                src={resolveApiUrl(asset.streamUrl)}
                                onClick={() => setActiveVideoAsset(asset)}
                                aspect={16 / 9}
                              />
                            </div>
                          ) : isImg && asset.streamUrl ? (
                            <div className="smc-row__thumb smc-row__thumb--img">
                              <img src={resolveApiUrl(asset.streamUrl)} alt={asset.name} loading="lazy" />
                            </div>
                          ) : (
                            <div className="smc-row__icon">
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                                <rect x="1" y="1" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.2"/>
                              </svg>
                            </div>
                          )}

                          <div className="smc-row__info">
                            <span className="smc-row__name">{asset.name}</span>
                            <div className="smc-row__meta">
                              {asset.duration && <span>{asset.duration}</span>}
                              {fmtBytes(asset.fileSizeBytes) && <span>{fmtBytes(asset.fileSizeBytes)}</span>}
                              <time title={fmtAbsolute(asset.createdAt)}>{timeAgo(asset.createdAt)}</time>
                            </div>
                          </div>

                          <div className="smc-row__actions">
                            {asset.mediaKind === 'video' && asset.streamUrl && (
                              <button
                                className="btn btn-ghost btn-icon"
                                type="button"
                                onClick={() => setActiveVideoAsset(asset)}
                                aria-label="Play"
                                title="Play"
                              >
                                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                                  <path d="M4 2.5v7l5-3.5-5-3.5Z" fill="currentColor"/>
                                </svg>
                              </button>
                            )}
                            {asset.downloadUrl && (
                              <a
                                className="btn btn-ghost btn-icon"
                                href={resolveApiUrl(asset.downloadUrl)}
                                target="_blank"
                                rel="noreferrer"
                                aria-label="Download"
                                title="Download"
                              >
                                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                                  <path d="M6 1.5v6M3.5 5.5 6 8l2.5-2.5M2 9.5h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              </a>
                            )}
                            <button
                              className="btn btn-ghost btn-icon"
                              type="button"
                              onClick={() => startEditAsset(asset)}
                              aria-label="Edit"
                              title="Edit"
                            >
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                                <path d="M8.5 1.5l2 2L4 10H2V8L8.5 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                              </svg>
                            </button>
                            <button
                              className="btn btn-danger btn-icon"
                              type="button"
                              onClick={() => removeAsset(asset)}
                              aria-label="Remove"
                              title="Remove"
                            >
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                                <path d="M2.5 3h7M4.5 3V2h3v1M5 5v4M7 5v4M3.5 3l.4 6.2a1 1 0 001 .8h1.2a1 1 0 001-.8L8 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                          </div>

                          {editingAssetId === asset.id && (
                            <div className="asset-edit-form smc-row__edit">
                              <div className="form-row">
                                <input
                                  className="input"
                                  value={editAssetName}
                                  onChange={e => setEditAssetName(e.target.value)}
                                  placeholder="Asset name"
                                />
                                <select
                                  className="select"
                                  value={editAssetCategory}
                                  onChange={e => setEditAssetCategory(e.target.value as AssetCategory)}
                                >
                                  {CATEGORY_ORDER.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                                </select>
                                <input
                                  className="input"
                                  value={editAssetVersionGroup}
                                  onChange={e => setEditAssetVersionGroup(e.target.value)}
                                  placeholder="Version group"
                                />
                                <button
                                  className="btn btn-primary btn-icon"
                                  type="button"
                                  onClick={() => saveAssetEdit(asset.id)}
                                  disabled={savingAssetEdit || !editAssetName.trim()}
                                  aria-label="Save"
                                  title="Save"
                                >
                                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                                    <path d="M2 6.5 4.5 9 10 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                </button>
                                <button
                                  className="btn btn-ghost btn-icon"
                                  type="button"
                                  onClick={() => setEditingAssetId(null)}
                                  aria-label="Cancel"
                                  title="Cancel"
                                >
                                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                                    <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                                  </svg>
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            }

            const section = groupedSections.find(s => s.category === category);
            if (!section?.groups.length) return null;
            return (
              <div key={category} className="asset-section">
                <p className="asset-section__label">
                  {category}
                  <span className="asset-section__count">{section.groups.length}</span>
                </p>
                <div className="asset-grid">
                  {section.groups.map(group => renderVersionedCard(`${category}::${group.groupKey}`, group))}
                </div>
              </div>
            );
          })}

          {song.shotListUrl && (() => {
            const m = song.shotListUrl.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
            const embedUrl = m ? `https://docs.google.com/document/d/${m[1]}/preview?embedded=true` : null;
            return (
              <div className="asset-section shot-list-section">
                <p className="asset-section__label">
                  Shot List
                  <span className="asset-section__count">1</span>
                </p>
                <div className="card shot-list-card shot-list-card--in-assets">
                  <div className="shot-list-link-row">
                    <svg className="shot-list-doc-icon" width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                      <rect width="20" height="20" rx="3" fill="#4285F4" opacity="0.15"/>
                      <path d="M5 5h6l4 4v6a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z" stroke="#4285F4" strokeWidth="1.2" fill="none"/>
                      <path d="M11 5v4h4" stroke="#4285F4" strokeWidth="1.2" strokeLinejoin="round" fill="none"/>
                      <path d="M7 10h6M7 12h6M7 14h4" stroke="#4285F4" strokeWidth="1" strokeLinecap="round"/>
                    </svg>
                    <span className="shot-list-label">Google Doc</span>
                    <div className="shot-list-link-actions">
                      <a
                        className="btn btn-primary btn-icon"
                        href={song.shotListUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Open in Docs"
                        title="Open in Docs"
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                          <path d="M4 2.5h5.5V8M9.5 2.5 2.5 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </a>
                      <button
                        className="btn btn-ghost btn-icon"
                        type="button"
                        onClick={() => { setUploadMode('shotlist'); setUploadOpen(true); setShotListInput(song.shotListUrl ?? ''); }}
                        aria-label="Edit shot list link"
                        title="Edit link"
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                          <path d="M8.5 1.5l2 2L4 10H2V8L8.5 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                        </svg>
                      </button>
                      <button
                        className="btn btn-ghost btn-icon"
                        type="button"
                        onClick={() => setShotListEmbedOpen(open => !open)}
                        aria-label={shotListEmbedOpen ? 'Collapse embed' : 'Expand embed'}
                        title={shotListEmbedOpen ? 'Collapse embed' : 'Expand embed'}
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                          <path d={shotListEmbedOpen ? 'M2.5 7.5 6 4l3.5 3.5' : 'M2.5 4.5 6 8l3.5-3.5'} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                  {embedUrl && shotListEmbedOpen && (
                    <iframe
                      src={embedUrl}
                      className="shot-list-embed"
                      title="Shot List"
                      loading="lazy"
                      allow=""
                    />
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* ── Sidebar ────────────────────────────────────────────────────── */}
      <div className="sidebar">

        <div className="card sidebar-panel">
          <p className="sidebar-panel__title">Song Notes</p>
          <form className="form-stack" onSubmit={createNote}>
            <textarea
              className="textarea"
              value={noteBody}
              onChange={e => setNoteBody(e.target.value)}
              placeholder="Creative notes, mix changes, direction..."
              required
            />
            <button className="btn btn-ghost btn-sm" type="submit" style={{ alignSelf: 'flex-start' }}>Add note</button>
          </form>
          {song.notes.length > 0 && (
            <ul className="note-list sidebar-note-list">
              {song.notes.map(note => (
                <li key={note.id} className="note-item">
                  <div className="note-item__meta">
                    <span className="note-item__author">{note.author}</span>
                    <time className="note-item__time" dateTime={note.createdAt} title={fmtAbsolute(note.createdAt)}>
                      {timeAgo(note.createdAt)}
                    </time>
                    <button
                      className="btn btn-ghost btn-icon note-item__delete"
                      type="button"
                      onClick={() => deleteNote(note.id)}
                      aria-label="Delete note"
                      title="Delete note"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                        <path d="M2 3h8M5 3V2h2v1M3 3l.5 7h5L9 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                  </div>
                  <p className="note-item__body">{note.body}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card sidebar-panel">
          <p className="sidebar-panel__title">Tasks</p>
          <form className="form-stack" onSubmit={createTask}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input className="input" value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="New task" required />
              <button className="btn btn-ghost btn-sm" type="submit" style={{ flexShrink: 0 }}>Add</button>
            </div>
          </form>
          {song.tasks.length > 0 && (
            <ul className="task-list">
              {song.tasks.map(task => (
                <li key={task.id} className={`task-item task-item--${task.status.toLowerCase().replace(' ', '-')}`}>
                  <div className="task-item__row">
                    <span className="task-item__title">{task.title}</span>
                    <select
                      className="select task-item__select"
                      value={task.status}
                      onChange={e => updateTaskStatus(task.id, e.target.value as SongTaskStatus)}
                    >
                      <option value="Open">Open</option>
                      <option value="In Review">In Review</option>
                      <option value="Done">Done</option>
                    </select>
                    <button
                      className="btn btn-ghost btn-icon task-item__delete"
                      type="button"
                      onClick={() => deleteTask(task.id)}
                      aria-label="Delete task"
                      title="Delete task"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                        <path d="M2 3h8M5 3V2h2v1M3 3l.5 7h5L9 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                  </div>
                  {task.assignee && <span className="task-item__assignee">{task.assignee}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card sidebar-panel lyrics-panel">
          <div className="lyrics-panel__header">
            <p className="sidebar-panel__title">Lyrics</p>
            <button className="btn btn-primary btn-sm" type="button" onClick={saveLyrics} disabled={savingLyrics}>
              {savingLyrics ? 'Saving...' : 'Save lyrics'}
            </button>
          </div>
          <p className="lyrics-panel__hint">
            Use section headers like Genius: [Intro], [Verse 1], [Pre-Chorus], [Chorus], [Bridge], [Outro].
          </p>
          <textarea
            className="textarea lyrics-textarea"
            value={lyricsDraft}
            onChange={(e) => setLyricsDraft(e.target.value)}
            placeholder={'[Verse 1]\nYour lyrics here...\n\n[Chorus]\nYour chorus here...'}
          />
        </div>
      </div>

      {/* ── Video modal — no auto-fullscreen, user controls it ─────────── */}
      {activeVideoAsset && activeVideoUrl && (
        <div
          className="media-modal"
          role="dialog"
          aria-modal="true"
          onClick={e => { if (e.target === e.currentTarget) setActiveVideoAsset(null); }}
        >
          <div className="media-modal__panel">
            <div className="media-modal__header">
              <div>
                <h3>{activeVideoAsset.name}</h3>
                <p>{fmtType(activeVideoAsset.type)} · {activeVideoAsset.duration ?? 'Unknown duration'}</p>
              </div>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => setActiveVideoAsset(null)}>
                Close
              </button>
            </div>
            <video
              key={activeVideoUrl}
              src={activeVideoUrl}
              controls
              autoPlay
              preload="metadata"
              crossOrigin="use-credentials"
              className="media-element"
              onError={() => setError('Unable to stream this file.')}
            />
          </div>
        </div>
      )}
    </section>
    </>
  );
}
