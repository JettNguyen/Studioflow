import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { InstallPrompt } from './InstallPrompt';
import './AppShell.css';

export function AppShell() {
  const { user } = useAuth();

  const initials = user?.name
    ? user.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
    : '?';

  return (
    <div>
      <header className="topbar">

        {/* Logo — always far left, never wraps */}
        <NavLink to="/" className="topbar__brand">
          <div className="topbar__logo-mark">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
              <rect x="1" y="1" width="4.5" height="11" rx="1.5" fill="white" opacity="0.9" />
              <rect x="7.5" y="4.5" width="4.5" height="7.5" rx="1.5" fill="white" opacity="0.6" />
            </svg>
          </div>
          <span className="topbar__brand-name">Studioflow</span>
        </NavLink>

        {/* Nav — center, scrolls horizontally on mobile */}
        <nav className="topbar__nav">
          <NavLink
            to="/"
            end
            className={({ isActive }) => `topbar__nav-link${isActive ? ' active' : ''}`}
          >
            Projects
          </NavLink>
          <NavLink
            to="/ai-lab"
            className={({ isActive }) => `topbar__nav-link${isActive ? ' active' : ''}`}
          >
            AI Lab
          </NavLink>
        </nav>

        {/* Actions — always far right */}
        <div className="topbar__actions">
          <NavLink
            to="/profile"
            className={({ isActive }) => `topbar__profile-btn${isActive ? ' active' : ''}`}
            aria-label="Profile"
          >
            {initials}
          </NavLink>
        </div>

      </header>

      <main className="page-content">
        <Outlet />
      </main>

      <InstallPrompt />
    </div>
  );
}
