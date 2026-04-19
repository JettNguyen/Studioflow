const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL;
const defaultProdApiBaseUrl = 'https://studioflow-api-pi.vercel.app/api';
const normalizedApiBaseUrl = configuredApiBaseUrl?.trim();
const apiBaseUrl = normalizedApiBaseUrl && normalizedApiBaseUrl !== '/api'
  ? normalizedApiBaseUrl
  : (import.meta.env.PROD ? defaultProdApiBaseUrl : 'http://localhost:4000/api');
const normalizedUploadBaseUrl = import.meta.env.VITE_UPLOAD_BASE_URL?.trim();
const uploadBaseUrl = normalizedUploadBaseUrl && normalizedUploadBaseUrl !== '/api'
  ? normalizedUploadBaseUrl
  : apiBaseUrl;
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
