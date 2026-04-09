import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiRequest } from '../lib/api';
export function ProjectPage() {
    const { projectId } = useParams();
    const [project, setProject] = useState(null);
    const [title, setTitle] = useState('');
    const [error, setError] = useState(null);
    useEffect(() => {
        if (!projectId) {
            return;
        }
        apiRequest(`/projects/${projectId}`)
            .then(setProject)
            .catch((loadError) => {
            setError(loadError instanceof Error ? loadError.message : 'Unable to load project');
        });
    }, [projectId]);
    const createSong = async (event) => {
        event.preventDefault();
        if (!projectId) {
            return;
        }
        try {
            const song = await apiRequest(`/songs/project/${projectId}`, {
                method: 'POST',
                body: {
                    title
                }
            });
            setTitle('');
            window.location.href = `/projects/${projectId}/songs/${song.id}`;
        }
        catch (createError) {
            setError(createError instanceof Error ? createError.message : 'Unable to create song');
        }
    };
    if (!project) {
        return _jsx("p", { children: error ?? 'Loading project...' });
    }
    return (_jsxs("section", { children: [_jsxs("div", { className: "section-head", children: [_jsxs("div", { children: [_jsx("h2", { children: project.title }), _jsx("p", { children: project.description })] }), _jsxs("div", { className: "chip-wrap", children: [_jsxs("span", { className: "badge", children: ["Drive: ", project.driveSyncStatus] }), _jsx("span", { children: project.driveFolderId ? 'Folder linked' : 'No Drive folder yet' })] })] }), _jsxs("article", { className: "panel form-panel", children: [_jsx("h3", { children: "Create Song" }), _jsxs("form", { className: "inline-form", onSubmit: createSong, children: [_jsx("input", { value: title, onChange: (event) => setTitle(event.target.value), placeholder: "Song title", required: true }), _jsx("button", { className: "button", type: "submit", children: "Create song" })] })] }), project.songs.length ? (_jsx("div", { className: "song-list", children: project.songs.map((song) => (_jsxs("article", { className: "song-item", children: [_jsxs("div", { children: [_jsx("h3", { children: song.title }), _jsx("p", { children: song.status })] }), _jsxs("div", { className: "chip-wrap", children: [_jsxs("span", { children: [song.assetCount, " assets"] }), _jsxs("span", { children: [song.taskOpenCount, " open tasks"] }), _jsx(Link, { to: `/projects/${project.id}/songs/${song.id}`, children: "Open song" })] })] }, song.id))) })) : (_jsxs("article", { className: "panel empty-panel", children: [_jsx("h3", { children: "No songs yet" }), _jsx("p", { children: "Create the first song in this project to start working." })] }))] }));
}
