import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { ProjectPage } from './pages/ProjectPage';
import { SongWorkspacePage } from './pages/SongWorkspacePage';
export default function App() {
    return (_jsxs(Routes, { children: [_jsxs(Route, { element: _jsx(AppShell, {}), children: [_jsx(Route, { path: "/", element: _jsx(DashboardPage, {}) }), _jsx(Route, { path: "/projects/:projectId", element: _jsx(ProjectPage, {}) }), _jsx(Route, { path: "/projects/:projectId/songs/:songId", element: _jsx(SongWorkspacePage, {}) })] }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "/", replace: true }) })] }));
}
