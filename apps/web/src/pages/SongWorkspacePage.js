import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useParams } from 'react-router-dom';
import { demoSongWorkspace } from '../seedData';
export function SongWorkspacePage() {
    const { songId } = useParams();
    const song = demoSongWorkspace.find((item) => item.id === songId);
    if (!song) {
        return _jsx("p", { children: "Song not found." });
    }
    return (_jsxs("section", { className: "workspace-grid", children: [_jsxs("article", { className: "panel panel-wide", children: [_jsxs("div", { className: "section-head", children: [_jsxs("div", { children: [_jsx("h2", { children: song.title }), _jsxs("p", { children: [song.key, " | ", song.bpm, " BPM"] })] }), _jsx("button", { className: "button", children: "Upload Stem" })] }), _jsx("ul", { className: "asset-list", children: song.assets.map((asset) => (_jsxs("li", { children: [_jsx("strong", { children: asset.name }), _jsx("span", { children: asset.type }), _jsx("span", { children: asset.duration })] }, asset.id))) })] }), _jsxs("article", { className: "panel", children: [_jsx("h3", { children: "Notes" }), _jsx("ul", { className: "stack-list", children: song.notes.map((note) => (_jsxs("li", { children: [_jsx("strong", { children: note.author }), _jsx("p", { children: note.body })] }, note.id))) })] }), _jsxs("article", { className: "panel", children: [_jsx("h3", { children: "Tasks" }), _jsx("ul", { className: "stack-list", children: song.tasks.map((task) => (_jsxs("li", { children: [_jsx("strong", { children: task.title }), _jsxs("p", { children: [task.assignee, " \u2022 ", task.status] })] }, task.id))) })] })] }));
}
