import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ProjectCard } from '../components/ProjectCard';
import { demoProjects } from '../seedData';
export function DashboardPage() {
    return (_jsxs("section", { children: [_jsxs("div", { className: "section-head", children: [_jsxs("div", { children: [_jsx("h2", { children: "Your Music Projects" }), _jsx("p", { children: "All songs, stems, notes, and tasks in one place." })] }), _jsx("button", { className: "button", children: "New Project" })] }), _jsx("div", { className: "project-grid", children: demoProjects.map((project) => (_jsx(ProjectCard, { project: project }, project.id))) })] }));
}
