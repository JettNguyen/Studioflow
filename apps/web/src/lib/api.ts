const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL;
const apiBaseUrl = configuredApiBaseUrl || (import.meta.env.PROD ? '/api' : 'http://localhost:4000/api');
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
  const response = await fetch(`${apiBaseUrl}${path}`, {
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
