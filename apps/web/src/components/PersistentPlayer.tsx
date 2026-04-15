import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAudioPlayer } from '../context/AudioPlayerContext';
import './PersistentPlayer.css';

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

export function PersistentPlayer() {
  const { currentTrack, playing, time, duration, volume, toggle, seek, skip, setVolume } =
    useAudioPlayer();
  const navigate = useNavigate();
  const progressBarRef = useRef<HTMLDivElement>(null);

  if (!currentTrack) return null;

  const progress = duration > 0 ? Math.min(1, time / duration) : 0;

  const onProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const bar = progressBarRef.current;
    if (!bar || !duration) return;
    const { left, width } = bar.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (e.clientX - left) / width));
    seek(p * duration);
  };

  return (
    <div className="pp" role="region" aria-label="Now playing">

      {/* ── Left: track info ── */}
      <button
        className="pp__track"
        onClick={() => navigate(currentTrack.pageUrl)}
        title="Go to track page"
        aria-label={`${currentTrack.title} — click to go to track page`}
      >
        <div className="pp__icon" aria-hidden="true">
          {/* Music note */}
          <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor">
            <path d="M11.5 1.5v8.25a2.25 2.25 0 1 1-1.5-2.12V4.5l-5 1.25v5a2.25 2.25 0 1 1-1.5-2.12V2.25L11.5 1.5Z" />
          </svg>
        </div>
        <div className="pp__meta">
          <span className="pp__title">{currentTrack.title}</span>
          {currentTrack.subtitle && (
            <span className="pp__subtitle">{currentTrack.subtitle}</span>
          )}
        </div>
      </button>

      {/* ── Center: controls + scrubber ── */}
      <div className="pp__center">
        <div className="pp__controls">

          {/* Skip back 10s */}
          <button
            className="pp__ctrl-btn"
            onClick={() => skip(-10)}
            aria-label="Skip back 10 seconds"
          >
            <svg width="20" height="20" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
              <path d="M9 2a7 7 0 1 1-7 7h1.5A5.5 5.5 0 1 0 9 3.5V2Z" />
              <path d="M9 2v4l3-2-3-2Z" />
              <text x="9" y="11.5" textAnchor="middle" fontSize="4.5" fontWeight="700" fontFamily="system-ui">10</text>
            </svg>
          </button>

          {/* Play / Pause */}
          <button
            className={`pp__play-btn${playing ? ' pp__play-btn--playing' : ''}`}
            onClick={toggle}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? (
              <svg width="11" height="13" viewBox="0 0 11 13" fill="currentColor" aria-hidden="true">
                <rect x="0" y="0" width="4" height="13" rx="1" />
                <rect x="7" y="0" width="4" height="13" rx="1" />
              </svg>
            ) : (
              <svg width="11" height="13" viewBox="0 0 11 13" fill="currentColor" aria-hidden="true">
                <path d="M1 1L10.5 6.5L1 12V1Z" />
              </svg>
            )}
          </button>

          {/* Skip forward 10s */}
          <button
            className="pp__ctrl-btn"
            onClick={() => skip(10)}
            aria-label="Skip forward 10 seconds"
          >
            <svg width="20" height="20" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
              <path d="M9 2a7 7 0 1 0 7 7h-1.5A5.5 5.5 0 1 1 9 3.5V2Z" />
              <path d="M9 2v4l-3-2 3-2Z" />
              <text x="9" y="11.5" textAnchor="middle" fontSize="4.5" fontWeight="700" fontFamily="system-ui">10</text>
            </svg>
          </button>
        </div>

        {/* Progress scrubber */}
        <div className="pp__scrubber">
          <span className="pp__time">{fmt(time)}</span>
          <div
            className="pp__bar"
            ref={progressBarRef}
            onClick={onProgressClick}
            role="slider"
            aria-label="Playback position"
            aria-valuenow={Math.round(time)}
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
          >
            <div className="pp__bar-fill" style={{ width: `${progress * 100}%` }} />
            <div className="pp__bar-thumb" style={{ left: `${progress * 100}%` }} />
          </div>
          <span className="pp__time">{fmt(duration)}</span>
        </div>
      </div>

      {/* ── Right: volume (hidden on touch) ── */}
      <div className="pp__right">
        <svg className="pp__vol-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          {volume === 0 ? (
            <>
              <path d="M1 4.5H3.5L7 2v10L3.5 9.5H1v-5Z" fill="currentColor" />
              <path d="M9.5 5L12 7.5M12 5L9.5 7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </>
          ) : volume < 0.5 ? (
            <>
              <path d="M1 4.5H3.5L7 2v10L3.5 9.5H1v-5Z" fill="currentColor" />
              <path d="M9 6C9.6 6.7 9.6 7.3 9 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </>
          ) : (
            <>
              <path d="M1 4.5H3.5L7 2v10L3.5 9.5H1v-5Z" fill="currentColor" />
              <path d="M9 4.5C10.4 5.5 10.4 8.5 9 9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <path d="M10.5 3C12.8 4.5 12.8 9.5 10.5 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </>
          )}
        </svg>
        <input
          className="pp__vol-slider"
          type="range"
          min="0"
          max="1"
          step="0.02"
          value={volume}
          onChange={e => setVolume(parseFloat(e.target.value))}
          aria-label="Volume"
          style={{
            background: `linear-gradient(to right, var(--accent) ${volume * 100}%, var(--border-mid) ${volume * 100}%)`,
          }}
        />
      </div>

    </div>
  );
}
