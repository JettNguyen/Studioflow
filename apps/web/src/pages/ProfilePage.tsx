import type { DriveConnectionStatus } from '@studioflow/shared';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { apiRequest } from '../lib/api';
import './ProfilePage.css';

export function ProfilePage() {
  const { user, logout } = useAuth();
  const [driveStatus, setDriveStatus] = useState<DriveConnectionStatus | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<DriveConnectionStatus>('/auth/drive-status')
      .then(setDriveStatus)
      .catch(e => setDriveError(e instanceof Error ? e.message : 'Unable to load Drive status'));
  }, []);

  const initials = user?.name
    ? user.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
    : '?';

  return (
    <section>
      <div className="page-header">
        <div className="page-header__main">
          <h2>Profile</h2>
          <p>Manage your account and connected services.</p>
        </div>
      </div>

      {/* ── Account ── */}
      <div className="card profile-account">
        <div className="profile-avatar" aria-hidden="true">{initials}</div>
        <div className="profile-account__info">
          <h3>{user?.name ?? 'Unknown'}</h3>
          {user?.email && <p className="profile-email">{user.email}</p>}
        </div>
      </div>

      {/* ── Google Drive ── */}
      <div className="card profile-section">
        <div className="profile-section__header">
          <div>
            <h3>Google Drive</h3>
            <p>Mirror project folders to Drive for backup and collaboration.</p>
          </div>
          <a
            className="btn btn-ghost btn-sm"
            href={`${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api'}/auth/google`}
          >
            {driveStatus?.connected ? 'Reconnect' : 'Connect Drive'}
          </a>
        </div>

        {driveError && <p className="form-error" style={{ marginBottom: '15px' }}>{driveError}</p>}

        <div className="drive-status-row">
          <div className={`drive-status-icon${driveStatus?.connected ? ' drive-status-icon--connected' : ' drive-status-icon--disconnected'}`}>
            {driveStatus?.connected ? (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path d="M3 9.5L7 13.5L15 5.5" stroke="#2ecf5e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <circle cx="9" cy="9" r="6.5" stroke="var(--text-3)" strokeWidth="1.5" />
                <path d="M9 6V9.5" stroke="var(--text-3)" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="9" cy="12" r="0.75" fill="var(--text-3)" />
              </svg>
            )}
          </div>
          <div>
            <p className="drive-status-label">
              {driveStatus?.connected ? 'Google Drive connected' : 'Not connected'}
            </p>
            <p className="drive-status-sub">
              {driveStatus?.connected
                ? `${driveStatus.email} — ${driveStatus.scopes?.join(', ') || 'no scopes listed'}`
                : 'Connect your Google account to sync project folders automatically.'}
            </p>
          </div>
        </div>
      </div>

      {/* ── Danger zone ── */}
      <div className="card profile-section profile-section--danger">
        <div className="profile-section__header">
          <div>
            <h3>Sign out</h3>
            <p>Log out of your Studioflow account on this device.</p>
          </div>
          <button className="btn btn-danger btn-sm" onClick={() => logout()}>
            Sign out
          </button>
        </div>
      </div>
    </section>
  );
}
