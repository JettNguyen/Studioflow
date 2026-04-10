import { useEffect, useState } from 'react';
import './InstallPrompt.css';

/** The browser fires this before showing its own install UI. We capture it to trigger manually. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallPrompt() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Already running as an installed PWA — nothing to show.
    if (
      window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in window.navigator && (window.navigator as { standalone?: boolean }).standalone)
    ) {
      setInstalled(true);
      return;
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
    };

    const onInstalled = () => {
      setInstalled(true);
      setPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed || dismissed || !prompt) return null;

  const handleInstall = async () => {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') setInstalled(true);
    setPrompt(null);
  };

  return (
    <div className="install-banner" role="complementary" aria-label="Install app">
      <div className="install-banner__icon" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="1" y="1" width="4" height="10" rx="1.2" fill="currentColor" opacity="0.9" />
          <rect x="7" y="3.5" width="4" height="7.5" rx="1.2" fill="currentColor" opacity="0.55" />
        </svg>
      </div>
      <div className="install-banner__text">
        <span className="install-banner__title">Install Studioflow</span>
        <span className="install-banner__sub">Add to home screen for offline access</span>
      </div>
      <button className="btn btn-primary btn-sm install-banner__cta" onClick={handleInstall}>
        Install
      </button>
      <button
        className="install-banner__close"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
