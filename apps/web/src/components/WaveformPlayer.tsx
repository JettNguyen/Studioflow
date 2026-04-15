import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioPlayer } from '../context/AudioPlayerContext';
import './WaveformPlayer.css';

interface WaveformPlayerProps {
  src: string;
  /** Displayed in the persistent bottom bar */
  trackTitle?: string;
  /** Secondary line in the persistent bottom bar (e.g. song name) */
  trackSubtitle?: string;
  /** Route to navigate to when the bottom bar is clicked */
  pageUrl?: string;
}

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

export function WaveformPlayer({ src, trackTitle, trackSubtitle, pageUrl }: WaveformPlayerProps) {
  const audioPlayer = useAudioPlayer();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const animRef = useRef<number>(0);
  const progressRef = useRef(0);
  const isDragging = useRef(false);
  // Blob URL created during decode — passed to context on play; not revoked here
  const blobUrlRef = useRef<string | null>(null);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [volume, setVolumeState] = useState(1);

  // Derive active/playing state from the global context
  const isActive = audioPlayer.isCurrentTrack(src);
  const playing = isActive && audioPlayer.playing;

  const redraw = useCallback((progress: number) => {
    const canvas = canvasRef.current;
    const buf = bufferRef.current;
    if (!canvas || !buf) return;

    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    if (!W || !H) return;

    const dpr = window.devicePixelRatio || 1;
    const cw = Math.round(W * dpr);
    const ch = Math.round(H * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const data = buf.getChannelData(0);
    const barW = 2;
    const gap = 1;
    const count = Math.floor(W / (barW + gap));
    const step = Math.max(1, Math.floor(data.length / count));
    const mid = H / 2;
    const playedCount = Math.round(progress * count);

    for (let i = 0; i < count; i++) {
      let mn = 0;
      let mx = 0;
      const base = i * step;
      for (let j = 0; j < step; j++) {
        const v = data[base + j] ?? 0;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      const h = Math.max(1.5, Math.abs(mx - mn) * mid * 0.9);
      ctx.fillStyle = i < playedCount ? 'rgba(117,160,245,0.88)' : 'rgba(117,160,245,0.26)';
      ctx.fillRect(i * (barW + gap), mid - h, barW, h * 2);
    }

    if (progress > 0 && progress < 1) {
      const px = Math.max(0, Math.round(playedCount * (barW + gap)) - 1);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(px, 0, 1, H);

      ctx.beginPath();
      ctx.arc(px + 0.5, mid, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
    }
  }, []);

  // ── Load + decode waveform data ───────────────────────────────────────────
  useEffect(() => {
    setStatus('loading');
    setTime(0);
    setDur(0);
    progressRef.current = 0;
    bufferRef.current = null;

    const ctrl = new AbortController();

    (async () => {
      try {
        const res = await fetch(src, { credentials: 'include', signal: ctrl.signal });
        if (!res.ok) throw new Error('fetch');
        const ab = await res.arrayBuffer();
        if (ctrl.signal.aborted) return;

        // Clone before decoding: decodeAudioData transfers (detaches) the ArrayBuffer
        const abForBlob = ab.slice(0);
        const contentType = res.headers.get('content-type') || 'audio/mpeg';

        const ac = new AudioContext();
        const buf = await ac.decodeAudioData(ab);
        void ac.close();
        if (ctrl.signal.aborted) return;

        bufferRef.current = buf;
        setDur(buf.duration);

        // Build a blob URL and hand it to the context when play is pressed.
        // We intentionally do NOT revoke this URL here — the context owns it
        // once loadTrack() is called and will revoke when the track changes.
        const blob = new Blob([abForBlob], { type: contentType });
        blobUrlRef.current = URL.createObjectURL(blob);

        setStatus('ready');
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setStatus('error');
      }
    })();

    return () => {
      ctrl.abort();
      // If this track is active in the context, the context owns the blob URL.
      // Otherwise revoke it now so we don't leak memory.
      if (blobUrlRef.current && !audioPlayer.isCurrentTrack(src)) {
        URL.revokeObjectURL(blobUrlRef.current);
      }
      blobUrlRef.current = null;
    };
    // audioPlayer intentionally excluded from deps — only re-run on src change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // ── Redraw on resize once ready ───────────────────────────────────────────
  useEffect(() => {
    if (status !== 'ready') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => redraw(progressRef.current));
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [status, redraw]);

  // ── Animation loop — reads from the global audio element when active ──────
  useEffect(() => {
    if (!playing) {
      // When not playing, keep waveform in sync with global time if active
      if (isActive) {
        const t = audioPlayer.audioRef.current?.currentTime ?? 0;
        const d = audioPlayer.audioRef.current?.duration || dur || 1;
        progressRef.current = t / d;
        setTime(t);
        redraw(t / d);
      }
      return;
    }

    const tick = () => {
      const audio = audioPlayer.audioRef.current;
      if (!audio) return;
      const t = audio.currentTime;
      const d = audio.duration || 1;
      progressRef.current = t / d;
      setTime(t);
      redraw(t / d);
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [playing, isActive, dur, redraw, audioPlayer.audioRef]);

  // ── Sync waveform when a different track starts (we become inactive) ──────
  useEffect(() => {
    if (!isActive) {
      progressRef.current = 0;
      setTime(0);
      redraw(0);
    }
  }, [isActive, redraw]);

  // ── Global mouse handlers for drag-seek ───────────────────────────────────
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !isActive) return;
      const canvas = canvasRef.current;
      const audio = audioPlayer.audioRef.current;
      if (!canvas || !audio) return;
      const { left, width } = canvas.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (e.clientX - left) / width));
      audioPlayer.seek(p * (audio.duration || 0));
      progressRef.current = p;
      setTime(p * (audio.duration || 0));
      redraw(p);
    };

    const onMouseUp = () => { isDragging.current = false; };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [redraw, isActive, audioPlayer]);

  // ── Controls ──────────────────────────────────────────────────────────────

  const toggle = () => {
    if (!blobUrlRef.current) return;
    if (isActive) {
      audioPlayer.toggle();
    } else {
      // Hand blob URL + metadata to the context — context owns the blob URL from here
      audioPlayer.loadTrack({
        src,
        blobUrl: blobUrlRef.current,
        title: trackTitle || 'Audio',
        subtitle: trackSubtitle || '',
        pageUrl: pageUrl || window.location.pathname,
      });
    }
  };

  const onSkip = (seconds: number) => {
    if (!isActive) return;
    audioPlayer.skip(seconds);
    const audio = audioPlayer.audioRef.current;
    if (audio) {
      const t = audio.currentTime;
      const d = audio.duration || 1;
      progressRef.current = t / d;
      setTime(t);
      redraw(t / d);
    }
  };

  const onCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (status !== 'ready') return;
    const canvas = canvasRef.current;
    const audio = audioPlayer.audioRef.current;
    if (!canvas) return;

    if (!isActive) {
      // First click on canvas: start playing this track
      toggle();
      return;
    }
    if (!audio) return;

    isDragging.current = true;
    const { left, width } = canvas.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (e.clientX - left) / width));
    audioPlayer.seek(p * (audio.duration || 0));
    progressRef.current = p;
    setTime(p * (audio.duration || 0));
    redraw(p);
  };

  const onVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolumeState(v);
    if (isActive) audioPlayer.setVolume(v);
  };

  // Sync local volume display with global volume when this track becomes active
  useEffect(() => {
    if (isActive) setVolumeState(audioPlayer.volume);
  }, [isActive, audioPlayer.volume]);

  return (
    <div className="wfp">
      {/* Top row: play button + waveform */}
      <div className="wfp-top">
        <button
          className={`wfp-btn${playing ? ' wfp-btn--playing' : ''}`}
          type="button"
          onClick={toggle}
          disabled={status !== 'ready'}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? (
            <svg width="8" height="10" viewBox="0 0 8 10" fill="currentColor" aria-hidden="true">
              <rect x="0" y="0" width="2.8" height="10" rx="0.8" />
              <rect x="5.2" y="0" width="2.8" height="10" rx="0.8" />
            </svg>
          ) : (
            <svg width="9" height="11" viewBox="0 0 9 11" fill="currentColor" aria-hidden="true">
              <path d="M1 1L8.5 5.5L1 10V1Z" />
            </svg>
          )}
        </button>

        <div className="wfp-track">
          {status === 'loading' && <span className="wfp-msg">Loading waveform...</span>}
          {status === 'error' && <span className="wfp-msg wfp-msg--err">Audio unavailable</span>}
          {status === 'ready' && (
            <canvas
              ref={canvasRef}
              className="wfp-canvas"
              onMouseDown={onCanvasMouseDown}
            />
          )}
        </div>
      </div>

      {/* Bottom row: volume + time */}
      <div className="wfp-controls">
        <div className="wfp-volume">
          <svg className="wfp-volume__icon" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            {volume === 0 ? (
              <>
                <path d="M1 4H3.5L6.5 1.5V10.5L3.5 8H1V4Z" fill="currentColor" />
                <path d="M8.5 4.5L11 7M11 4.5L8.5 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </>
            ) : volume < 0.5 ? (
              <>
                <path d="M1 4H3.5L6.5 1.5V10.5L3.5 8H1V4Z" fill="currentColor" />
                <path d="M8 5.5C8.5 6 8.5 6.5 8 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </>
            ) : (
              <>
                <path d="M1 4H3.5L6.5 1.5V10.5L3.5 8H1V4Z" fill="currentColor" />
                <path d="M8 4C9.2 5 9.2 7 8 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <path d="M9.5 2.5C11.5 4 11.5 8 9.5 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </>
            )}
          </svg>
          <input
            className="wfp-volume__slider"
            type="range"
            min="0"
            max="1"
            step="0.02"
            value={volume}
            onChange={onVolumeChange}
            aria-label="Volume"
            style={{ background: `linear-gradient(to right, var(--accent) ${volume * 100}%, var(--border-mid) ${volume * 100}%)` }}
          />
        </div>

        <div className="wfp-right">
          {/* Skip -10s */}
          <button
            className="wfp-skip-btn"
            type="button"
            onClick={() => onSkip(-10)}
            disabled={!isActive}
            aria-label="Skip back 10 seconds"
            title="-10s"
          >
            <svg width="16" height="16" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
              <path d="M7 1.5a5.5 5.5 0 1 1-5.5 5.5H3A4 4 0 1 0 7 3v-1.5Z" />
              <path d="M7 1.5V5L9.5 3.25 7 1.5Z" />
              <text x="7" y="9.5" textAnchor="middle" fontSize="4" fontWeight="700" fontFamily="system-ui">10</text>
            </svg>
          </button>

          {/* Skip +10s */}
          <button
            className="wfp-skip-btn"
            type="button"
            onClick={() => onSkip(10)}
            disabled={!isActive}
            aria-label="Skip forward 10 seconds"
            title="+10s"
          >
            <svg width="16" height="16" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
              <path d="M7 1.5a5.5 5.5 0 1 0 5.5 5.5H11A4 4 0 1 1 7 3v-1.5Z" />
              <path d="M7 1.5V5L4.5 3.25 7 1.5Z" />
              <text x="7" y="9.5" textAnchor="middle" fontSize="4" fontWeight="700" fontFamily="system-ui">10</text>
            </svg>
          </button>

          <span className="wfp-time">
            <span className="wfp-time-cur">{fmt(time)}</span>
            <span className="wfp-sep">/</span>
            <span className="wfp-time-dur">{fmt(dur)}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
