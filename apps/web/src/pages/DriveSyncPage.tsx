import type { DriveConnectionStatus } from '@studioflow/shared';
import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import './DriveSyncPage.css';

export function DriveSyncPage() {
  const [status, setStatus] = useState<DriveConnectionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<DriveConnectionStatus>('/auth/drive-status')
      .then(setStatus)
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load Drive status');
      });
  }, []);

  return (
    <section>
      <div className="page-header">
        <div className="page-header__main">
          <h2>Drive Sync</h2>
          <p>Mirror project folders to Google Drive for backup and sharing.</p>
        </div>
        <div className="page-header__aside">
          <a
            className="btn btn-primary"
            href={`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api'}/auth/google`}
          >
            {status?.connected ? 'Reconnect Drive' : 'Link Google Drive'}
          </a>
        </div>
      </div>

      {error && <p className="form-error" style={{ marginBottom: '16px' }}>{error}</p>}

      <div className="card">
        <div className="drive-status-card">
          <div className={`drive-status-icon ${status?.connected ? 'drive-status-icon--connected' : 'drive-status-icon--disconnected'}`}>
            {status?.connected ? (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path d="M3 9.5L7 13.5L15 5.5" stroke="#3ecf8e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <circle cx="9" cy="9" r="6.5" stroke="var(--text-3)" strokeWidth="1.5"/>
                <path d="M9 6V9.5" stroke="var(--text-3)" strokeWidth="1.5" strokeLinecap="round"/>
                <circle cx="9" cy="12" r="0.75" fill="var(--text-3)"/>
              </svg>
            )}
          </div>
          <div className="drive-status-body">
            <h3>{status?.connected ? 'Google Drive connected' : 'Google Drive not connected'}</h3>
            <p>
              {status?.connected
                ? `Connected as ${status.email}. Granted scopes: ${status.scopes.join(', ') || 'none listed'}.`
                : 'Connect your Google account to automatically create project folders in Drive when you create a project.'}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
