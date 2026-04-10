import { useEffect, useRef, useState } from 'react';
import './VideoThumbnail.css';

interface VideoThumbnailProps {
  src: string;
  onClick?: () => void;
  /** Aspect ratio — default 16/9 */
  aspect?: number;
}

export function VideoThumbnail({ src, onClick, aspect = 16 / 9 }: VideoThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    setState('loading');
    const video = document.createElement('video');
    video.crossOrigin = 'use-credentials';
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const cleanup = () => {
      video.src = '';
      video.load();
    };

    video.addEventListener('loadedmetadata', () => {
      // Seek to 10% into the video for a more representative frame
      video.currentTime = Math.min(video.duration * 0.1, 3);
    });

    video.addEventListener('seeked', () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = video.videoWidth || 320;
      canvas.height = video.videoHeight || 180;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      setState('ready');
      cleanup();
    });

    video.addEventListener('error', () => {
      setState('error');
      cleanup();
    });

    video.src = src;

    return cleanup;
  }, [src]);

  const paddingBottom = `${(1 / aspect) * 100}%`;

  return (
    <div
      className={`vthumb${onClick ? ' vthumb--clickable' : ''}`}
      style={{ paddingBottom }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? e => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
      aria-label={onClick ? 'Play video' : undefined}
    >
      <canvas
        ref={canvasRef}
        className={`vthumb__canvas${state === 'ready' ? ' vthumb__canvas--ready' : ''}`}
      />

      {/* Dark overlay + play icon — always present, fade in on hover when ready */}
      {state !== 'error' && (
        <div className={`vthumb__overlay${state === 'ready' ? ' vthumb__overlay--ready' : ''}`}>
          {state === 'loading' && <span className="vthumb__spinner" aria-hidden="true" />}
          {state === 'ready' && onClick && (
            <div className="vthumb__play" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <circle cx="9" cy="9" r="9" fill="rgba(0,0,0,0.55)" />
                <path d="M7 5.5L13 9L7 12.5V5.5Z" fill="white" />
              </svg>
            </div>
          )}
        </div>
      )}

      {state === 'error' && (
        <div className="vthumb__error" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="1" width="14" height="14" rx="3" stroke="currentColor" strokeWidth="1.2" />
            <path d="M6 5l4 3-4 3V5Z" fill="currentColor" opacity="0.5" />
          </svg>
        </div>
      )}
    </div>
  );
}
