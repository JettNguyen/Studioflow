import type { DriveConnectionStatus } from '@studioflow/shared';
import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';

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
      <div className="section-head">
        <div>
          <h2>Drive Sync</h2>
          <p>Track mirrored folders, sync health, and file conflicts across projects.</p>
        </div>
        <a className="button" href={`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api'}/auth/google`}>
          Link Google Drive
        </a>
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      <article className="panel empty-panel">
        <h3>{status?.connected ? 'Google Drive connected' : 'Google Drive not connected'}</h3>
        <p>
          {status?.connected
            ? `Connected account: ${status.email}. Granted scopes: ${status.scopes.join(', ') || 'none listed'}.`
            : 'Sign in with Google to create project folders in Drive automatically when you create a project.'}
        </p>
      </article>
    </section>
  );
}