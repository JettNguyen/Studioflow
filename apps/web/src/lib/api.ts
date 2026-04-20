const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
// In production, default to the Vercel proxy (/api) so that session cookies are
// set on the same domain as the frontend. This prevents Safari's ITP bounce
// tracking mitigation from deleting cookies set via cross-domain OAuth redirects.
const apiBaseUrl = configuredApiBaseUrl || (import.meta.env.PROD ? '/api' : 'http://localhost:4000/api');
const configuredUploadBaseUrl = import.meta.env.VITE_UPLOAD_BASE_URL?.trim();
const uploadBaseUrl = configuredUploadBaseUrl || apiBaseUrl;
const apiOrigin = /^https?:\/\//i.test(apiBaseUrl)
  ? apiBaseUrl.replace(/\/api\/?$/, '')
  : '';

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    const contentType = response.headers.get('content-type');
    const payload = contentType?.includes('application/json') ? await response.json() : null;
    throw new Error(payload?.message || `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export async function apiUpload<T>(path: string, formData: FormData, options: Omit<RequestInit, 'body'> = {}) {
  const response = await fetch(`${uploadBaseUrl}${path}`, {
    method: 'POST',
    credentials: 'include',
    ...options,
    body: formData
  });

  if (!response.ok) {
    const contentType = response.headers.get('content-type');
    const payload = contentType?.includes('application/json') ? await response.json() : null;
    throw new Error(payload?.message || `Upload failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function apiUploadWithProgress<T>(
  path: string,
  formData: FormData,
  onProgress: (pct: number) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${uploadBaseUrl}${path}`);
    xhr.withCredentials = true;

    onProgress(1);

    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) {
        onProgress(Math.max(1, Math.round((e.loaded / e.total) * 100)));
      } else {
        // Some browsers/media sources don't expose total bytes; keep UI alive.
        onProgress(5);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        try { resolve(JSON.parse(xhr.responseText) as T); }
        catch { reject(new Error('Invalid response')); }
      } else {
        try {
          const payload = JSON.parse(xhr.responseText);
          reject(new Error(payload?.message || `Upload failed with status ${xhr.status}`));
        } catch {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));

    xhr.send(formData);
  });
}

const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB per chunk

function xhrPost<T>(url: string, formData: FormData, onProgress: (pct: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true;
    onProgress(1); // show bar immediately before first progress event
    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) onProgress(Math.max(2, Math.round((e.loaded / e.total) * 100)));
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText) as T); }
        catch { reject(new Error('Invalid response')); }
      } else {
        try {
          const p = JSON.parse(xhr.responseText);
          reject(new Error(p?.message || `Request failed: ${xhr.status}`));
        } catch { reject(new Error(`Request failed: ${xhr.status}`)); }
      }
    });
    xhr.addEventListener('error', () => reject(new Error('Network error')));
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));
    xhr.send(formData);
  });
}

export async function uploadChunkedWithProgress<T>(
  path: string,
  file: File,
  extraFields: Record<string, string>,
  onProgress: (pct: number) => void
): Promise<T> {
  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  let driveSessionUri = '';

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const chunk = file.slice(start, start + CHUNK_SIZE);

    const fd = new FormData();
    fd.append('file', chunk, file.name);
    fd.append('chunkIndex', String(i));
    fd.append('totalChunks', String(totalChunks));
    fd.append('totalSizeBytes', String(file.size));
    if (driveSessionUri) fd.append('driveSessionUri', driveSessionUri);
    for (const [k, v] of Object.entries(extraFields)) fd.append(k, v);

    const data = await xhrPost<Record<string, unknown>>(
      `${uploadBaseUrl}${path}`, fd,
      pct => onProgress(Math.max(1, Math.round(((i + pct / 100) / totalChunks) * 100)))
    );

    if (i === totalChunks - 1) {
      onProgress(100);
      return data as T;
    }
    driveSessionUri = data.driveSessionUri as string;
  }

  throw new Error('Chunked upload completed without receiving the final asset.');
}

export function resolveApiUrl(path: string) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  if (path.startsWith('/api/')) {
    return apiOrigin ? `${apiOrigin}${path}` : path;
  }

  return `${apiBaseUrl}${path}`;
}

export function getGoogleAuthUrl() {
  return `${apiBaseUrl}/auth/google`;
}
