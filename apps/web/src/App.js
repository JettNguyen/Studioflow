import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { AppShell } from './components/AppShell';
import { AiLabPage } from './pages/AiLabPage';
import { DashboardPage } from './pages/DashboardPage';
import { DriveSyncPage } from './pages/DriveSyncPage';
import { LoginPage } from './pages/LoginPage';
import { ProjectPage } from './pages/ProjectPage';
import { SongWorkspacePage } from './pages/SongWorkspacePage';
export default function App() {
    return (_jsxs(Routes, { children: [_jsx(Route, { path: "/login", element: _jsx(LoginPage, {}) }), _jsx(Route, { element: _jsx(ProtectedRoute, {}), children: _jsxs(Route, { element: _jsx(AppShell, {}), children: [_jsx(Route, { path: "/", element: _jsx(DashboardPage, {}) }), _jsx(Route, { path: "/drive-sync", element: _jsx(DriveSyncPage, {}) }), _jsx(Route, { path: "/ai-lab", element: _jsx(AiLabPage, {}) }), _jsx(Route, { path: "/projects/:projectId", element: _jsx(ProjectPage, {}) }), _jsx(Route, { path: "/projects/:projectId/songs/:songId", element: _jsx(SongWorkspacePage, {}) })] }) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "/", replace: true }) })] }));
}
