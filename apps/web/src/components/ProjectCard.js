import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link } from 'react-router-dom';
export function ProjectCard({ project }) {
    return (_jsxs(Link, { to: `/projects/${project.id}`, className: "project-card", "aria-label": `Open project ${project.title}`, children: [_jsxs("div", { className: "project-card__head", children: [_jsx("span", { className: "badge", children: project.genre }), _jsxs("span", { children: [project.collaboratorCount, " collaborators"] })] }), _jsx("h3", { children: project.title }), _jsx("p", { children: project.description }), _jsx("div", { className: "project-card__footer", children: _jsxs("span", { children: [project.songCount, " songs"] }) })] }));
}
