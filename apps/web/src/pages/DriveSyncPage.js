import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
export function DriveSyncPage() {
    const [status, setStatus] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => {
        apiRequest('/auth/drive-status')
            .then(setStatus)
            .catch((loadError) => {
            setError(loadError instanceof Error ? loadError.message : 'Unable to load Drive status');
        });
    }, []);
    return (_jsxs("section", { children: [_jsxs("div", { className: "section-head", children: [_jsxs("div", { children: [_jsx("h2", { children: "Drive Sync" }), _jsx("p", { children: "Track mirrored folders, sync health, and file conflicts across projects." })] }), _jsx("a", { className: "button", href: `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api'}/auth/google`, children: "Link Google Drive" })] }), error ? _jsx("p", { className: "form-error", children: error }) : null, _jsxs("article", { className: "panel empty-panel", children: [_jsx("h3", { children: status?.connected ? 'Google Drive connected' : 'Google Drive not connected' }), _jsx("p", { children: status?.connected
                            ? `Connected account: ${status.email}. Granted scopes: ${status.scopes.join(', ') || 'none listed'}.`
                            : 'Sign in with Google to create project folders in Drive automatically when you create a project.' })] })] }));
}
