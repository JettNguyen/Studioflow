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
import { apiRequest, apiUpload, resolveApiUrl } from '../lib/api';
import './SongWorkspacePage.css';

const categoryOrder: AssetCategory[] = [
  'Song Audio',
  'Social Media Content',
  'Videos',
  'Beat',
  'Stems'
];

function formatDuration(durationInSeconds: number) {
  if (!Number.isFinite(durationInSeconds) || durationInSeconds <= 0) {
    return null;
  }

  const rounded = Math.round(durationInSeconds);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function prettifyAssetType(asset: SongAsset) {
  if (asset.type.startsWith('audio/')) {
    const subtype = asset.type.split('/')[1]?.toUpperCase() || 'AUDIO';
    return `${subtype} Audio`;
  }

  if (asset.type.startsWith('video/')) {
    const subtype = asset.type.split('/')[1]?.toUpperCase() || 'VIDEO';
    return `${subtype} Video`;
  }

  return asset.type;
}

function formatFileSize(bytes: number | null) {
  if (!bytes || bytes <= 0) {
    return null;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function readFileDuration(file: File) {
  const mediaKind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'other';

  if (mediaKind === 'other') {
    return null;
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const media = document.createElement(mediaKind === 'video' ? 'video' : 'audio');
    media.preload = 'metadata';

    return await new Promise<string | null>((resolve) => {
      const cleanup = () => {
        URL.revokeObjectURL(objectUrl);
      };

      media.onloadedmetadata = () => {
        const formatted = formatDuration(media.duration);
        cleanup();
        resolve(formatted);
      };

      media.onerror = () => {
        cleanup();
        resolve(null);
      };

      media.src = objectUrl;
    });
  } catch {
    URL.revokeObjectURL(objectUrl);
    return null;
  }
}

export function SongWorkspacePage() {
  const { songId } = useParams();
  const [song, setSong] = useState<SongWorkspace | null>(null);
  const [noteBody, setNoteBody] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [assetName, setAssetName] = useState('');
  const [assetCategory, setAssetCategory] = useState<AssetCategory>('Song Audio');
  const [assetVersionGroup, setAssetVersionGroup] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [activeAudioAssetId, setActiveAudioAssetId] = useState<string | null>(null);
  const [activeVideoAsset, setActiveVideoAsset] = useState<SongAsset | null>(null);
  const [selectedVersionByGroup, setSelectedVersionByGroup] = useState<Record<string, string>>({});
  const [assetNoteDrafts, setAssetNoteDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeVideoAssetUrl = useMemo(
    () => (activeVideoAsset?.streamUrl ? resolveApiUrl(activeVideoAsset.streamUrl) : null),
    [activeVideoAsset]
  );

  const groupedSections = useMemo(() => {
    if (!song) {
      return [] as Array<{ category: AssetCategory; groups: Array<{ groupKey: string; versions: SongAsset[] }> }>;
    }

    return categoryOrder.map((category) => {
      const categoryAssets = song.assets.filter((asset) => asset.category === category);
      const groupMap = new Map<string, SongAsset[]>();

      for (const asset of categoryAssets) {
        const key = asset.versionGroup;
        const existing = groupMap.get(key) ?? [];
        existing.push(asset);
        groupMap.set(key, existing);
      }

      const groups = Array.from(groupMap.entries())
        .map(([groupKey, versions]) => ({
          groupKey,
          versions: versions.sort((a, b) => b.versionNumber - a.versionNumber)
        }))
        .sort((a, b) => {
          const aLatest = a.versions[0];
          const bLatest = b.versions[0];
          return new Date(bLatest.createdAt).getTime() - new Date(aLatest.createdAt).getTime();
        });

      return { category, groups };
    });
  }, [song]);

  useEffect(() => {
    if (!songId) {
      return;
    }

    apiRequest<SongWorkspace>(`/songs/${songId}`)
      .then((loadedSong) => {
        setSong(loadedSong);
        setError(null);
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load song');
      });
  }, [songId]);

  useEffect(() => {
    const defaults: Record<string, string> = {};

    for (const section of groupedSections) {
      for (const group of section.groups) {
        const composedKey = `${section.category}::${group.groupKey}`;
        defaults[composedKey] = group.versions[0]?.id;
      }
    }

    setSelectedVersionByGroup((current) => {
      const next = { ...current };
      for (const [key, value] of Object.entries(defaults)) {
        if (!next[key]) {
          next[key] = value;
        }
      }
      return next;
    });
  }, [groupedSections]);

  useEffect(() => {
    if (activeVideoAsset?.mediaKind !== 'video' || !videoRef.current) {
      return;
    }

    const fullscreen = videoRef.current.requestFullscreen?.();
    if (fullscreen && typeof fullscreen.catch === 'function') {
      fullscreen.catch(() => undefined);
    }
  }, [activeVideoAsset]);

  const handlePlaybackError = () => {
    setError('Unable to stream this media file. Please verify API session and storage access.');
  };

  const refreshSong = async () => {
    if (!songId) {
      return;
    }

    const updatedSong = await apiRequest<SongWorkspace>(`/songs/${songId}`);
    setSong(updatedSong);
  };

  const createNote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!songId || !song) {
      return;
    }

    try {
      const created = await apiRequest<SongWorkspace['notes'][number]>(`/songs/${songId}/notes`, {
        method: 'POST',
        body: {
          body: noteBody
        } satisfies CreateNoteRequest
      });
      setSong({ ...song, notes: [created, ...song.notes] });
      setNoteBody('');
      setError(null);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to add note');
    }
  };

  const createTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!songId || !song) {
      return;
    }

    try {
      const created = await apiRequest<SongWorkspace['tasks'][number]>(`/songs/${songId}/tasks`, {
        method: 'POST',
        body: {
          title: taskTitle
        } satisfies CreateTaskRequest
      });
      setSong({ ...song, tasks: [created, ...song.tasks] });
      setTaskTitle('');
      setError(null);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to add task');
    }
  };

  const uploadAsset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!songId || !selectedFile) {
      setError('Please choose a file to upload.');
      return;
    }

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('category', assetCategory);

      if (assetName.trim()) {
        formData.append('name', assetName.trim());
      }

      if (assetVersionGroup.trim()) {
        formData.append('versionGroup', assetVersionGroup.trim());
      }

      const duration = await readFileDuration(selectedFile);
      if (duration) {
        formData.append('duration', duration);
      }

      await apiUpload<SongWorkspace['assets'][number]>(`/songs/${songId}/assets`, formData, {
        method: 'POST'
      });

      setAssetName('');
      setAssetVersionGroup('');
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      await refreshSong();
      setError(null);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Unable to upload file');
    }
  };

  const updateTaskStatus = async (taskId: string, status: SongTaskStatus) => {
    if (!songId || !song) {
      return;
    }

    try {
      const updated = await apiRequest<SongWorkspace['tasks'][number]>(`/songs/${songId}/tasks/${taskId}`, {
        method: 'PATCH',
        body: {
          status
        } satisfies UpdateTaskStatusRequest
      });

      setSong({
        ...song,
        tasks: song.tasks.map((task) => (task.id === taskId ? updated : task))
      });
      setError(null);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update task status');
    }
  };

  const removeAsset = async (asset: SongAsset) => {
    if (!song) {
      return;
    }

    const confirmed = window.confirm(`Remove asset "${asset.name}"? This cannot be undone.`);
    if (!confirmed) {
      return;
    }

    try {
      await apiRequest(`/assets/${asset.id}`, { method: 'DELETE' });
      setSong({
        ...song,
        assets: song.assets.filter((item) => item.id !== asset.id)
      });

      if (activeAudioAssetId === asset.id) {
        setActiveAudioAssetId(null);
      }

      if (activeVideoAsset?.id === asset.id) {
        setActiveVideoAsset(null);
      }

      setSelectedVersionByGroup((current) => {
        const next = { ...current };
        for (const [key, value] of Object.entries(next)) {
          if (value === asset.id) {
            delete next[key];
          }
        }
        return next;
      });

      setError(null);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Unable to remove asset');
    }
  };

  const addAssetNote = async (asset: SongAsset) => {
    const draft = (assetNoteDrafts[asset.id] || '').trim();
    if (!draft) {
      return;
    }

    try {
      const created = await apiRequest<SongAsset['notes'][number]>(`/assets/${asset.id}/notes`, {
        method: 'POST',
        body: {
          body: draft
        } satisfies CreateAssetNoteRequest
      });

      if (!song) {
        return;
      }

      setSong({
        ...song,
        assets: song.assets.map((item) =>
          item.id === asset.id
            ? {
                ...item,
                notes: [created, ...item.notes]
              }
            : item
        )
      });

      setAssetNoteDrafts((current) => ({ ...current, [asset.id]: '' }));
      setError(null);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to add file note');
    }
  };

  if (!song) {
    return <p>{error ?? 'Loading song...'}</p>;
  }

  return (
    <section className="workspace-grid">
      <article className="panel panel-wide">
        <div className="section-head">
          <div>
            <h2>{song.title}</h2>
            <p>{song.key ?? 'Key pending'} | {song.bpm ?? '--'} BPM</p>
          </div>
          <span className="badge">{song.status}</span>
        </div>

        <form className="stack-form upload-form" onSubmit={uploadAsset}>
          <input
            value={assetName}
            onChange={(event) => setAssetName(event.target.value)}
            placeholder="Asset name (optional)"
          />
          <select
            className="select-field"
            value={assetCategory}
            onChange={(event) => setAssetCategory(event.target.value as AssetCategory)}
          >
            {categoryOrder.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
          <input
            value={assetVersionGroup}
            onChange={(event) => setAssetVersionGroup(event.target.value)}
            placeholder="Version group (optional, e.g. chorus-vocal-main)"
          />

          <div className="file-picker-row">
            <label className="button button-ghost file-picker-label" htmlFor="asset-upload-input">
              Choose file
            </label>
            <span className="file-picker-name">{selectedFile?.name ?? 'No file selected'}</span>
            <input
              id="asset-upload-input"
              ref={fileInputRef}
              className="file-picker-hidden"
              type="file"
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              required
            />
          </div>

          <button className="button" type="submit">Upload file</button>
        </form>

        <div className="song-sections">
          {groupedSections.map((section) => (
            <article className="asset-section" key={section.category}>
              <h3>{section.category}</h3>

              {section.groups.length ? (
                <div className="asset-section-grid">
                  {section.groups.map((group) => {
                    const composedKey = `${section.category}::${group.groupKey}`;
                    const selectedId = selectedVersionByGroup[composedKey] || group.versions[0].id;
                    const selectedVersion = group.versions.find((asset) => asset.id === selectedId) || group.versions[0];

                    return (
                      <div className="asset-card" key={composedKey}>
                        <div className="asset-card__head">
                          <strong>{selectedVersion.name}</strong>
                          <span className="badge">v{selectedVersion.versionNumber}</span>
                        </div>

                        <div className="asset-version-controls">
                          <label>History</label>
                          <select
                            className="select-field"
                            value={selectedVersion.id}
                            onChange={(event) =>
                              setSelectedVersionByGroup((current) => ({ ...current, [composedKey]: event.target.value }))
                            }
                          >
                            {group.versions.map((version) => (
                              <option key={version.id} value={version.id}>
                                v{version.versionNumber} - {new Date(version.createdAt).toLocaleString()}
                              </option>
                            ))}
                          </select>
                        </div>

                        <p>{prettifyAssetType(selectedVersion)} - {selectedVersion.duration ?? 'Unknown duration'}</p>

                        {(selectedVersion.sampleRateHz ||
                          selectedVersion.bitrateKbps ||
                          selectedVersion.channels ||
                          selectedVersion.codec ||
                          selectedVersion.container ||
                          selectedVersion.fileSizeBytes) ? (
                          <div className="asset-metadata">
                            {selectedVersion.sampleRateHz ? <span>{selectedVersion.sampleRateHz} Hz</span> : null}
                            {selectedVersion.bitrateKbps ? <span>{selectedVersion.bitrateKbps} kbps</span> : null}
                            {selectedVersion.channels ? <span>{selectedVersion.channels} ch</span> : null}
                            {selectedVersion.codec ? <span>{selectedVersion.codec}</span> : null}
                            {selectedVersion.container ? <span>{selectedVersion.container}</span> : null}
                            {selectedVersion.fileSizeBytes ? <span>{formatFileSize(selectedVersion.fileSizeBytes)}</span> : null}
                          </div>
                        ) : null}

                        <div className="asset-actions">
                          {selectedVersion.streamUrl && selectedVersion.mediaKind !== 'other' ? (
                            selectedVersion.mediaKind === 'audio' ? (
                              <button
                                className="button button-ghost"
                                type="button"
                                onClick={() =>
                                  setActiveAudioAssetId((current) =>
                                    current === selectedVersion.id ? null : selectedVersion.id
                                  )
                                }
                              >
                                {activeAudioAssetId === selectedVersion.id ? 'Hide player' : 'Play'}
                              </button>
                            ) : (
                              <button
                                className="button button-ghost"
                                type="button"
                                onClick={() => setActiveVideoAsset(selectedVersion)}
                              >
                                Play
                              </button>
                            )
                          ) : null}

                          {selectedVersion.downloadUrl ? (
                            <a href={resolveApiUrl(selectedVersion.downloadUrl)} target="_blank" rel="noreferrer">
                              Download
                            </a>
                          ) : null}

                          <button className="button button-ghost" type="button" onClick={() => removeAsset(selectedVersion)}>
                            Remove
                          </button>
                        </div>

                        {selectedVersion.mediaKind === 'audio' &&
                        selectedVersion.streamUrl &&
                        activeAudioAssetId === selectedVersion.id ? (
                          <audio
                            src={resolveApiUrl(selectedVersion.streamUrl)}
                            controls
                            autoPlay
                            preload="metadata"
                            crossOrigin="use-credentials"
                            className="media-element media-inline"
                            onError={handlePlaybackError}
                          />
                        ) : null}

                        <div className="asset-notes">
                          <h4>File Notes</h4>
                          <div className="stack-form">
                            <textarea
                              value={assetNoteDrafts[selectedVersion.id] || ''}
                              onChange={(event) =>
                                setAssetNoteDrafts((current) => ({
                                  ...current,
                                  [selectedVersion.id]: event.target.value
                                }))
                              }
                              placeholder="Notes for this version only"
                            />
                            <button className="button button-ghost" type="button" onClick={() => addAssetNote(selectedVersion)}>
                              Add file note
                            </button>
                          </div>

                          <ul className="stack-list">
                            {selectedVersion.notes.map((note) => (
                              <li key={note.id}>
                                <strong>{note.author}</strong>
                                <p>{note.body}</p>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="section-empty">No files in this section yet.</p>
              )}
            </article>
          ))}
        </div>
      </article>

      <article className="panel">
        <h3>Song Notes</h3>
        <form className="stack-form" onSubmit={createNote}>
          <textarea
            value={noteBody}
            onChange={(event) => setNoteBody(event.target.value)}
            placeholder="Leave creative notes, mix changes, or vocal direction"
            required
          />
          <button className="button" type="submit">Add note</button>
        </form>
        <ul className="stack-list">
          {song.notes.map((note) => (
            <li key={note.id}>
              <strong>{note.author}</strong>
              <p>{note.body}</p>
            </li>
          ))}
        </ul>
      </article>

      <article className="panel">
        <h3>Tasks</h3>
        <form className="stack-form" onSubmit={createTask}>
          <input
            value={taskTitle}
            onChange={(event) => setTaskTitle(event.target.value)}
            placeholder="New task"
            required
          />
          <button className="button" type="submit">Add task</button>
        </form>
        {error ? <p className="form-error">{error}</p> : null}
        <ul className="stack-list">
          {song.tasks.map((task) => (
            <li key={task.id}>
              <strong>{task.title}</strong>
              <p>{task.assignee ?? 'Unassigned'} - {task.status}</p>
              <select
                className="select-field"
                value={task.status}
                onChange={(event) => updateTaskStatus(task.id, event.target.value as SongTaskStatus)}
              >
                <option value="Open">Open</option>
                <option value="In Review">In Review</option>
                <option value="Done">Done</option>
              </select>
            </li>
          ))}
        </ul>
      </article>

      {activeVideoAsset && activeVideoAssetUrl ? (
        <div className="media-modal" role="dialog" aria-modal="true">
          <div className="media-modal__panel">
            <div className="section-head">
              <div>
                <h3>{activeVideoAsset.name}</h3>
                <p>{prettifyAssetType(activeVideoAsset)}</p>
              </div>
              <button className="button button-ghost" type="button" onClick={() => setActiveVideoAsset(null)}>
                Close
              </button>
            </div>

            {activeVideoAsset.mediaKind === 'video' ? (
              <video
                ref={videoRef}
                src={activeVideoAssetUrl}
                controls
                autoPlay
                preload="metadata"
                crossOrigin="use-credentials"
                className="media-element"
                onError={handlePlaybackError}
              />
            ) : (
              <p>This file type cannot be previewed in-app yet. Use download instead.</p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
