import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { ProjectCard } from '../components/ProjectCard';
export function DashboardPage() {
    const [projects, setProjects] = useState([]);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [genre, setGenre] = useState('');
    const [error, setError] = useState(null);
    useEffect(() => {
        apiRequest('/projects')
            .then(setProjects)
            .catch((loadError) => {
            setError(loadError instanceof Error ? loadError.message : 'Unable to load projects');
        });
    }, []);
    const createProject = async (event) => {
        event.preventDefault();
        setError(null);
        try {
            const project = await apiRequest('/projects', {
                method: 'POST',
                body: {
                    title,
                    ...(description.trim() ? { description: description.trim() } : {}),
                    ...(genre.trim() ? { genre: genre.trim() } : {})
                }
            });
            setTitle('');
            setDescription('');
            setGenre('');
            window.location.href = `/projects/${project.id}`;
        }
        catch (createError) {
            setError(createError instanceof Error ? createError.message : 'Unable to create project');
        }
    };
    return (_jsxs("section", { children: [_jsx("div", { className: "section-head", children: _jsxs("div", { children: [_jsx("h2", { children: "Your Music Projects" }), _jsx("p", { children: "All songs, stems, notes, and tasks in one place." })] }) }), _jsxs("article", { className: "panel form-panel", children: [_jsx("h3", { children: "Create Project" }), _jsxs("form", { className: "inline-form", onSubmit: createProject, children: [_jsx("input", { value: title, onChange: (event) => setTitle(event.target.value), placeholder: "Project title", required: true }), _jsx("input", { value: genre, onChange: (event) => setGenre(event.target.value), placeholder: "Genre (optional)" }), _jsx("input", { value: description, onChange: (event) => setDescription(event.target.value), placeholder: "Short description (optional)" }), _jsx("button", { className: "button", type: "submit", children: "Create project" })] }), error ? _jsx("p", { className: "form-error", children: error }) : null] }), projects.length ? (_jsx("div", { className: "project-grid", children: projects.map((project) => (_jsx(ProjectCard, { project: project }, project.id))) })) : (_jsxs("article", { className: "panel empty-panel", children: [_jsx("h3", { children: "No projects yet" }), _jsx("p", { children: "Create your first project to start organizing songs, notes, and collaborators." })] }))] }));
}
