import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { ProjectPage } from './pages/ProjectPage';
import { SongWorkspacePage } from './pages/SongWorkspacePage';

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/projects/:projectId" element={<ProjectPage />} />
        <Route path="/projects/:projectId/songs/:songId" element={<SongWorkspacePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
