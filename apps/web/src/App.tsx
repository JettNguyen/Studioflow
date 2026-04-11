import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { AppShell } from './components/AppShell';

const DashboardPage = lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const ProjectPage = lazy(() => import('./pages/ProjectPage').then(m => ({ default: m.ProjectPage })));
const SongWorkspacePage = lazy(() => import('./pages/SongWorkspacePage').then(m => ({ default: m.SongWorkspacePage })));
const AiLabPage = lazy(() => import('./pages/AiLabPage').then(m => ({ default: m.AiLabPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then(m => ({ default: m.ProfilePage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })));

export default function App() {
  return (
    <Suspense fallback={<div className="page-spinner" />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            {/* Legacy redirect — drive sync now lives in /profile */}
            <Route path="/drive-sync" element={<Navigate to="/profile" replace />} />
            <Route path="/ai-lab" element={<AiLabPage />} />
            <Route path="/projects/:projectId" element={<ProjectPage />} />
            <Route path="/projects/:projectId/songs/:songId" element={<SongWorkspacePage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
