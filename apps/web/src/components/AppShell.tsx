import { NavLink, Outlet } from 'react-router-dom';

export function AppShell() {
  return (
    <div className="app-bg">
      <div className="orb orb-a" />
      <div className="orb orb-b" />
      <header className="topbar">
        <h1>Studioflow</h1>
        <nav>
          <NavLink to="/">Projects</NavLink>
          <a href="#">Drive Sync</a>
          <a href="#">AI Lab</a>
        </nav>
        <button className="button button-ghost">Invite</button>
      </header>
      <main className="content-wrap">
        <Outlet />
      </main>
    </div>
  );
}
