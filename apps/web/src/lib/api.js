const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';
const apiOrigin = apiBaseUrl.replace(/\/api\/?$/, '');
export async function apiRequest(path, options = {}) {
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
        return undefined;
    }
    return response.json();
}
export async function apiUpload(path, formData, options = {}) {
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
    return response.json();
}
export function resolveApiUrl(path) {
    if (/^https?:\/\//i.test(path)) {
        return path;
    }
    if (path.startsWith('/api/')) {
        return `${apiOrigin}${path}`;
    }
    return `${apiBaseUrl}${path}`;
}
export function getGoogleAuthUrl() {
    return `${apiBaseUrl}/auth/google`;
}
