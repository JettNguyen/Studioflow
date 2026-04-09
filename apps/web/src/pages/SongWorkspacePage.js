import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiRequest, apiUpload, resolveApiUrl } from '../lib/api';
import './SongWorkspacePage.css';
const categoryOrder = [
    'Song Audio',
    'Social Media Content',
    'Videos',
    'Beat',
    'Stems'
];
function formatDuration(durationInSeconds) {
    if (!Number.isFinite(durationInSeconds) || durationInSeconds <= 0) {
        return null;
    }
    const rounded = Math.round(durationInSeconds);
    const minutes = Math.floor(rounded / 60);
    const seconds = rounded % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
function prettifyAssetType(asset) {
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
function formatFileSize(bytes) {
    if (!bytes || bytes <= 0) {
        return null;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(0)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
async function readFileDuration(file) {
    const mediaKind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'other';
    if (mediaKind === 'other') {
        return null;
    }
    const objectUrl = URL.createObjectURL(file);
    try {
        const media = document.createElement(mediaKind === 'video' ? 'video' : 'audio');
        media.preload = 'metadata';
        return await new Promise((resolve) => {
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
    }
    catch {
        URL.revokeObjectURL(objectUrl);
        return null;
    }
}
export function SongWorkspacePage() {
    const { songId } = useParams();
    const [song, setSong] = useState(null);
    const [noteBody, setNoteBody] = useState('');
    const [taskTitle, setTaskTitle] = useState('');
    const [assetName, setAssetName] = useState('');
    const [assetCategory, setAssetCategory] = useState('Song Audio');
    const [assetVersionGroup, setAssetVersionGroup] = useState('');
    const [selectedFile, setSelectedFile] = useState(null);
    const [activeAudioAssetId, setActiveAudioAssetId] = useState(null);
    const [activeVideoAsset, setActiveVideoAsset] = useState(null);
    const [selectedVersionByGroup, setSelectedVersionByGroup] = useState({});
    const [assetNoteDrafts, setAssetNoteDrafts] = useState({});
    const [error, setError] = useState(null);
    const videoRef = useRef(null);
    const fileInputRef = useRef(null);
    const activeVideoAssetUrl = useMemo(() => (activeVideoAsset?.streamUrl ? resolveApiUrl(activeVideoAsset.streamUrl) : null), [activeVideoAsset]);
    const groupedSections = useMemo(() => {
        if (!song) {
            return [];
        }
        return categoryOrder.map((category) => {
            const categoryAssets = song.assets.filter((asset) => asset.category === category);
            const groupMap = new Map();
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
        apiRequest(`/songs/${songId}`)
            .then((loadedSong) => {
            setSong(loadedSong);
            setError(null);
        })
            .catch((loadError) => {
            setError(loadError instanceof Error ? loadError.message : 'Unable to load song');
        });
    }, [songId]);
    useEffect(() => {
        const defaults = {};
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
        const updatedSong = await apiRequest(`/songs/${songId}`);
        setSong(updatedSong);
    };
    const createNote = async (event) => {
        event.preventDefault();
        if (!songId || !song) {
            return;
        }
        try {
            const created = await apiRequest(`/songs/${songId}/notes`, {
                method: 'POST',
                body: {
                    body: noteBody
                }
            });
            setSong({ ...song, notes: [created, ...song.notes] });
            setNoteBody('');
            setError(null);
        }
        catch (createError) {
            setError(createError instanceof Error ? createError.message : 'Unable to add note');
        }
    };
    const createTask = async (event) => {
        event.preventDefault();
        if (!songId || !song) {
            return;
        }
        try {
            const created = await apiRequest(`/songs/${songId}/tasks`, {
                method: 'POST',
                body: {
                    title: taskTitle
                }
            });
            setSong({ ...song, tasks: [created, ...song.tasks] });
            setTaskTitle('');
            setError(null);
        }
        catch (createError) {
            setError(createError instanceof Error ? createError.message : 'Unable to add task');
        }
    };
    const uploadAsset = async (event) => {
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
            await apiUpload(`/songs/${songId}/assets`, formData, {
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
        }
        catch (uploadError) {
            setError(uploadError instanceof Error ? uploadError.message : 'Unable to upload file');
        }
    };
    const updateTaskStatus = async (taskId, status) => {
        if (!songId || !song) {
            return;
        }
        try {
            const updated = await apiRequest(`/songs/${songId}/tasks/${taskId}`, {
                method: 'PATCH',
                body: {
                    status
                }
            });
            setSong({
                ...song,
                tasks: song.tasks.map((task) => (task.id === taskId ? updated : task))
            });
            setError(null);
        }
        catch (updateError) {
            setError(updateError instanceof Error ? updateError.message : 'Unable to update task status');
        }
    };
    const removeAsset = async (asset) => {
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
        }
        catch (removeError) {
            setError(removeError instanceof Error ? removeError.message : 'Unable to remove asset');
        }
    };
    const addAssetNote = async (asset) => {
        const draft = (assetNoteDrafts[asset.id] || '').trim();
        if (!draft) {
            return;
        }
        try {
            const created = await apiRequest(`/assets/${asset.id}/notes`, {
                method: 'POST',
                body: {
                    body: draft
                }
            });
            if (!song) {
                return;
            }
            setSong({
                ...song,
                assets: song.assets.map((item) => item.id === asset.id
                    ? {
                        ...item,
                        notes: [created, ...item.notes]
                    }
                    : item)
            });
            setAssetNoteDrafts((current) => ({ ...current, [asset.id]: '' }));
            setError(null);
        }
        catch (createError) {
            setError(createError instanceof Error ? createError.message : 'Unable to add file note');
        }
    };
    if (!song) {
        return _jsx("p", { children: error ?? 'Loading song...' });
    }
    return (_jsxs("section", { className: "workspace-grid", children: [_jsxs("article", { className: "panel panel-wide", children: [_jsxs("div", { className: "section-head", children: [_jsxs("div", { children: [_jsx("h2", { children: song.title }), _jsxs("p", { children: [song.key ?? 'Key pending', " | ", song.bpm ?? '--', " BPM"] })] }), _jsx("span", { className: "badge", children: song.status })] }), _jsxs("form", { className: "stack-form upload-form", onSubmit: uploadAsset, children: [_jsx("input", { value: assetName, onChange: (event) => setAssetName(event.target.value), placeholder: "Asset name (optional)" }), _jsx("select", { className: "select-field", value: assetCategory, onChange: (event) => setAssetCategory(event.target.value), children: categoryOrder.map((category) => (_jsx("option", { value: category, children: category }, category))) }), _jsx("input", { value: assetVersionGroup, onChange: (event) => setAssetVersionGroup(event.target.value), placeholder: "Version group (optional, e.g. chorus-vocal-main)" }), _jsxs("div", { className: "file-picker-row", children: [_jsx("label", { className: "button button-ghost file-picker-label", htmlFor: "asset-upload-input", children: "Choose file" }), _jsx("span", { className: "file-picker-name", children: selectedFile?.name ?? 'No file selected' }), _jsx("input", { id: "asset-upload-input", ref: fileInputRef, className: "file-picker-hidden", type: "file", onChange: (event) => setSelectedFile(event.target.files?.[0] ?? null), required: true })] }), _jsx("button", { className: "button", type: "submit", children: "Upload file" })] }), _jsx("div", { className: "song-sections", children: groupedSections.map((section) => (_jsxs("article", { className: "asset-section", children: [_jsx("h3", { children: section.category }), section.groups.length ? (_jsx("div", { className: "asset-section-grid", children: section.groups.map((group) => {
                                        const composedKey = `${section.category}::${group.groupKey}`;
                                        const selectedId = selectedVersionByGroup[composedKey] || group.versions[0].id;
                                        const selectedVersion = group.versions.find((asset) => asset.id === selectedId) || group.versions[0];
                                        return (_jsxs("div", { className: "asset-card", children: [_jsxs("div", { className: "asset-card__head", children: [_jsx("strong", { children: selectedVersion.name }), _jsxs("span", { className: "badge", children: ["v", selectedVersion.versionNumber] })] }), _jsxs("div", { className: "asset-version-controls", children: [_jsx("label", { children: "History" }), _jsx("select", { className: "select-field", value: selectedVersion.id, onChange: (event) => setSelectedVersionByGroup((current) => ({ ...current, [composedKey]: event.target.value })), children: group.versions.map((version) => (_jsxs("option", { value: version.id, children: ["v", version.versionNumber, " - ", new Date(version.createdAt).toLocaleString()] }, version.id))) })] }), _jsxs("p", { children: [prettifyAssetType(selectedVersion), " - ", selectedVersion.duration ?? 'Unknown duration'] }), (selectedVersion.sampleRateHz ||
                                                    selectedVersion.bitrateKbps ||
                                                    selectedVersion.channels ||
                                                    selectedVersion.codec ||
                                                    selectedVersion.container ||
                                                    selectedVersion.fileSizeBytes) ? (_jsxs("div", { className: "asset-metadata", children: [selectedVersion.sampleRateHz ? _jsxs("span", { children: [selectedVersion.sampleRateHz, " Hz"] }) : null, selectedVersion.bitrateKbps ? _jsxs("span", { children: [selectedVersion.bitrateKbps, " kbps"] }) : null, selectedVersion.channels ? _jsxs("span", { children: [selectedVersion.channels, " ch"] }) : null, selectedVersion.codec ? _jsx("span", { children: selectedVersion.codec }) : null, selectedVersion.container ? _jsx("span", { children: selectedVersion.container }) : null, selectedVersion.fileSizeBytes ? _jsx("span", { children: formatFileSize(selectedVersion.fileSizeBytes) }) : null] })) : null, _jsxs("div", { className: "asset-actions", children: [selectedVersion.streamUrl && selectedVersion.mediaKind !== 'other' ? (selectedVersion.mediaKind === 'audio' ? (_jsx("button", { className: "button button-ghost", type: "button", onClick: () => setActiveAudioAssetId((current) => current === selectedVersion.id ? null : selectedVersion.id), children: activeAudioAssetId === selectedVersion.id ? 'Hide player' : 'Play' })) : (_jsx("button", { className: "button button-ghost", type: "button", onClick: () => setActiveVideoAsset(selectedVersion), children: "Play" }))) : null, selectedVersion.downloadUrl ? (_jsx("a", { href: resolveApiUrl(selectedVersion.downloadUrl), target: "_blank", rel: "noreferrer", children: "Download" })) : null, _jsx("button", { className: "button button-ghost", type: "button", onClick: () => removeAsset(selectedVersion), children: "Remove" })] }), selectedVersion.mediaKind === 'audio' &&
                                                    selectedVersion.streamUrl &&
                                                    activeAudioAssetId === selectedVersion.id ? (_jsx("audio", { src: resolveApiUrl(selectedVersion.streamUrl), controls: true, autoPlay: true, preload: "metadata", crossOrigin: "use-credentials", className: "media-element media-inline", onError: handlePlaybackError })) : null, _jsxs("div", { className: "asset-notes", children: [_jsx("h4", { children: "File Notes" }), _jsxs("div", { className: "stack-form", children: [_jsx("textarea", { value: assetNoteDrafts[selectedVersion.id] || '', onChange: (event) => setAssetNoteDrafts((current) => ({
                                                                        ...current,
                                                                        [selectedVersion.id]: event.target.value
                                                                    })), placeholder: "Notes for this version only" }), _jsx("button", { className: "button button-ghost", type: "button", onClick: () => addAssetNote(selectedVersion), children: "Add file note" })] }), _jsx("ul", { className: "stack-list", children: selectedVersion.notes.map((note) => (_jsxs("li", { children: [_jsx("strong", { children: note.author }), _jsx("p", { children: note.body })] }, note.id))) })] })] }, composedKey));
                                    }) })) : (_jsx("p", { className: "section-empty", children: "No files in this section yet." }))] }, section.category))) })] }), _jsxs("article", { className: "panel", children: [_jsx("h3", { children: "Song Notes" }), _jsxs("form", { className: "stack-form", onSubmit: createNote, children: [_jsx("textarea", { value: noteBody, onChange: (event) => setNoteBody(event.target.value), placeholder: "Leave creative notes, mix changes, or vocal direction", required: true }), _jsx("button", { className: "button", type: "submit", children: "Add note" })] }), _jsx("ul", { className: "stack-list", children: song.notes.map((note) => (_jsxs("li", { children: [_jsx("strong", { children: note.author }), _jsx("p", { children: note.body })] }, note.id))) })] }), _jsxs("article", { className: "panel", children: [_jsx("h3", { children: "Tasks" }), _jsxs("form", { className: "stack-form", onSubmit: createTask, children: [_jsx("input", { value: taskTitle, onChange: (event) => setTaskTitle(event.target.value), placeholder: "New task", required: true }), _jsx("button", { className: "button", type: "submit", children: "Add task" })] }), error ? _jsx("p", { className: "form-error", children: error }) : null, _jsx("ul", { className: "stack-list", children: song.tasks.map((task) => (_jsxs("li", { children: [_jsx("strong", { children: task.title }), _jsxs("p", { children: [task.assignee ?? 'Unassigned', " - ", task.status] }), _jsxs("select", { className: "select-field", value: task.status, onChange: (event) => updateTaskStatus(task.id, event.target.value), children: [_jsx("option", { value: "Open", children: "Open" }), _jsx("option", { value: "In Review", children: "In Review" }), _jsx("option", { value: "Done", children: "Done" })] })] }, task.id))) })] }), activeVideoAsset && activeVideoAssetUrl ? (_jsx("div", { className: "media-modal", role: "dialog", "aria-modal": "true", children: _jsxs("div", { className: "media-modal__panel", children: [_jsxs("div", { className: "section-head", children: [_jsxs("div", { children: [_jsx("h3", { children: activeVideoAsset.name }), _jsx("p", { children: prettifyAssetType(activeVideoAsset) })] }), _jsx("button", { className: "button button-ghost", type: "button", onClick: () => setActiveVideoAsset(null), children: "Close" })] }), activeVideoAsset.mediaKind === 'video' ? (_jsx("video", { ref: videoRef, src: activeVideoAssetUrl, controls: true, autoPlay: true, preload: "metadata", crossOrigin: "use-credentials", className: "media-element", onError: handlePlaybackError })) : (_jsx("p", { children: "This file type cannot be previewed in-app yet. Use download instead." }))] }) })) : null] }));
}
