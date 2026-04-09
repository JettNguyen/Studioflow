import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link, useParams } from 'react-router-dom';
import { demoProjectDetails } from '../seedData';
export function ProjectPage() {
    const { projectId } = useParams();
    const project = demoProjectDetails.find((item) => item.id === projectId);
    if (!project) {
        return _jsx("p", { children: "Project not found." });
    }
    return (_jsxs("section", { children: [_jsxs("div", { className: "section-head", children: [_jsxs("div", { children: [_jsx("h2", { children: project.title }), _jsx("p", { children: project.description })] }), _jsxs("div", { className: "chip-wrap", children: [_jsxs("span", { className: "badge", children: ["Drive: ", project.driveSyncStatus] }), _jsx("button", { className: "button", children: "Sync now" })] })] }), _jsx("div", { className: "song-list", children: project.songs.map((song) => (_jsxs("article", { className: "song-item", children: [_jsxs("div", { children: [_jsx("h3", { children: song.title }), _jsx("p", { children: song.status })] }), _jsxs("div", { className: "chip-wrap", children: [_jsxs("span", { children: [song.assetCount, " assets"] }), _jsxs("span", { children: [song.taskOpenCount, " open tasks"] }), _jsx(Link, { to: `/projects/${project.id}/songs/${song.id}`, children: "Open song" })] })] }, song.id))) })] }));
}
