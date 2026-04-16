import type { AuthSessionResponse, DriveConnectionStatus, ProjectSummary } from '@studioflow/shared';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { apiRequest, apiUpload, getGoogleAuthUrl, resolveApiUrl } from '../lib/api';
import './ProfilePage.css';

export function ProfilePage() {
  const { user, logout, setUser } = useAuth();
  const [driveStatus, setDriveStatus] = useState<DriveConnectionStatus | null>(null);
  const [driveLoading, setDriveLoading] = useState(true);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [syncResults, setSyncResults] = useState<Record<string, 'ok' | 'err'>>({});
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiRequest<DriveConnectionStatus>('/auth/drive-status')
      .then(setDriveStatus)
      .catch(e => setDriveError(e instanceof Error ? e.message : 'Unable to load Drive status'))
      .finally(() => setDriveLoading(false));

    apiRequest<ProjectSummary[]>('/projects')
      .then(setProjects)
      .catch(() => {/* non-critical */});
  }, []);

  useEffect(() => {
    if (!avatarUploading) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [avatarUploading]);

  const retrySync = async (projectId: string) => {
    setSyncing(s => ({ ...s, [projectId]: true }));
    setSyncResults(r => { const next = { ...r }; delete next[projectId]; return next; });
    try {
      await apiRequest(`/projects/${projectId}/sync-drive`, { method: 'POST' });
      setSyncResults(r => ({ ...r, [projectId]: 'ok' }));
      // Refresh project list so status badge updates
      const updated = await apiRequest<ProjectSummary[]>('/projects');
      setProjects(updated);
    } catch {
      setSyncResults(r => ({ ...r, [projectId]: 'err' }));
    } finally {
      setSyncing(s => ({ ...s, [projectId]: false }));
    }
  };

  const uploadAvatar = async (file: File) => {
    setAvatarUploading(true);
    setAvatarError(null);
    const fd = new FormData();
    fd.append('image', file);
    try {
      const response = await apiUpload<AuthSessionResponse>('/auth/me/avatar', fd);
      if (response.user) {
        // Cache-bust so the browser fetches the new image instead of serving the
        // old one from cache (the avatar URL path is the same after re-upload).
        const u = response.user;
        setUser({
          ...u,
          avatarUrl: u.avatarUrl ? `${u.avatarUrl}?t=${Date.now()}` : u.avatarUrl,
        });
      }
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setAvatarUploading(false);
    }
  };

  const removeAvatar = async () => {
    setAvatarUploading(true);
    setAvatarError(null);
    try {
      const response = await apiRequest<AuthSessionResponse>('/auth/me/avatar', { method: 'DELETE' });
      setUser(response.user);
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Failed to remove photo');
    } finally {
      setAvatarUploading(false);
    }
  };

  const initials = user?.name
    ? user.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
    : '?';

  const needsAttentionProjects = projects.filter(p => p.driveSyncStatus === 'Needs Attention');

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
        <button
          className={`profile-avatar${avatarUploading ? ' profile-avatar--loading' : ''}`}
          onClick={() => avatarInputRef.current?.click()}
          aria-label="Change profile photo"
          type="button"
        >
          {user?.avatarUrl ? (
            <img src={resolveApiUrl(user.avatarUrl)} alt="" className="profile-avatar__img" />
          ) : (
            <span aria-hidden="true">{initials}</span>
          )}
          <span className="profile-avatar__overlay" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="12" cy="13" r="4" stroke="currentColor" strokeWidth="2"/>
            </svg>
          </span>
        </button>
        <input
          ref={avatarInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) { uploadAvatar(f); e.target.value = ''; }
          }}
        />
        <div className="profile-account__info">
          <h3>{user?.name ?? 'Unknown'}</h3>
          {user?.email && <p className="profile-email">{user.email}</p>}
          {user?.avatarUrl && (
            <button
              className="profile-avatar__remove"
              onClick={removeAvatar}
              disabled={avatarUploading}
              type="button"
            >
              Remove photo
            </button>
          )}
        </div>
      </div>

      {avatarError && <p className="form-error" style={{ marginBottom: '15px' }}>{avatarError}</p>}

      {/* ── Google Drive ── */}
      <div className="card profile-section">
        {driveLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="skeleton" style={{ height: 18, width: 110, borderRadius: 'var(--r-1)' }} />
                <div className="skeleton" style={{ height: 13, width: 240, borderRadius: 'var(--r-1)' }} />
              </div>
              <div className="skeleton skeleton--badge" style={{ width: 108, height: 30 }} />
            </div>
            <div style={{ display: 'flex', gap: 15, alignItems: 'center', marginTop: 4 }}>
              <div className="skeleton" style={{ width: 40, height: 40, borderRadius: 'var(--r-3)', flexShrink: 0 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                <div className="skeleton" style={{ height: 14, width: '40%', borderRadius: 'var(--r-1)' }} />
                <div className="skeleton" style={{ height: 12, width: '70%', borderRadius: 'var(--r-1)' }} />
              </div>
            </div>
          </div>
        ) : (
          <>
        <div className="profile-section__header">
          <div>
            <h3>Google Drive</h3>
            <p>Mirror project folders to Drive for backup and collaboration.</p>
          </div>
          {/* ?reauth=1 forces Google consent screen so a fresh refresh token is issued */}
          <a
            className="btn btn-ghost btn-sm"
            href={`${getGoogleAuthUrl()}?reauth=1`}
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

        {/* Projects needing attention */}
        {driveStatus?.connected && needsAttentionProjects.length > 0 && (
          <div className="drive-attention-list">
            <p className="drive-attention-heading">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                <path d="M6.5 1L12 12H1L6.5 1Z" stroke="var(--amber)" strokeWidth="1.3" strokeLinejoin="round"/>
                <path d="M6.5 5V7.5" stroke="var(--amber)" strokeWidth="1.3" strokeLinecap="round"/>
                <circle cx="6.5" cy="9.5" r="0.65" fill="var(--amber)"/>
              </svg>
              These projects failed to create a Drive folder:
            </p>
            {needsAttentionProjects.map(p => (
              <div key={p.id} className="drive-attention-row">
                <span className="drive-attention-row__name">{p.title}</span>
                <button
                  className="btn btn-sm"
                  onClick={() => retrySync(p.id)}
                  disabled={syncing[p.id]}
                >
                  {syncing[p.id] ? 'Retrying…' : 'Retry'}
                </button>
                {syncResults[p.id] === 'ok' && <span className="drive-attention-row__ok">Synced</span>}
                {syncResults[p.id] === 'err' && <span className="drive-attention-row__err">Failed</span>}
              </div>
            ))}
          </div>
        )}
          </>
        )}
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
