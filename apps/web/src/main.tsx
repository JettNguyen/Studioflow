import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { AudioPlayerProvider } from './context/AudioPlayerContext';
import { DropZoneProvider } from './context/DropZoneContext';
import App from './App';
import './styles.css';

// Register service worker in production only.
// The SW file lives in public/sw.js and is served from the root scope.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then(reg => {
        // Periodically check for SW updates (every 60 minutes).
        setInterval(() => reg.update(), 60 * 60 * 1000);
      })
      .catch(err => console.warn('[SW] Registration failed:', err));
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true
        }}
      >
        <AudioPlayerProvider>
          <DropZoneProvider>
            <App />
          </DropZoneProvider>
        </AudioPlayerProvider>
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>
);
