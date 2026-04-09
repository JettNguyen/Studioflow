import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function AppShell() {
  const { user, logout } = useAuth();

  return (
    <div className="app-bg">
      <div className="orb orb-a" />
      <div className="orb orb-b" />
      <header className="topbar">
        <h1>Studioflow</h1>
        <nav>
          <NavLink to="/">Projects</NavLink>
          <NavLink to="/drive-sync">Drive Sync</NavLink>
          <NavLink to="/ai-lab">AI Lab</NavLink>
        </nav>
        <div className="chip-wrap topbar-actions">
          <span className="topbar-user">{user?.name}</span>
          <button className="button button-ghost" onClick={() => logout()}>
            Log out
          </button>
        </div>
      </header>
      <main className="content-wrap">
        <Outlet />
      </main>
    </div>
  );
}
