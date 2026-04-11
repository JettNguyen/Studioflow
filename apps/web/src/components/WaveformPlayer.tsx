import { useCallback, useEffect, useRef, useState } from 'react';
import './WaveformPlayer.css';

interface WaveformPlayerProps {
  src: string;
}

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

export function WaveformPlayer({ src }: WaveformPlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const animRef = useRef<number>(0);
  const progressRef = useRef(0);
  const isDragging = useRef(false);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [volume, setVolume] = useState(1);

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

  // Load + decode waveform data
  useEffect(() => {
    setStatus('loading');
    setPlaying(false);
    setTime(0);
    progressRef.current = 0;
    bufferRef.current = null;

    const ctrl = new AbortController();

    (async () => {
      try {
        const res = await fetch(src, { credentials: 'include', signal: ctrl.signal });
        if (!res.ok) throw new Error('fetch');
        const ab = await res.arrayBuffer();
        if (ctrl.signal.aborted) return;
        const ac = new AudioContext();
        const buf = await ac.decodeAudioData(ab);
        void ac.close();
        if (ctrl.signal.aborted) return;
        bufferRef.current = buf;
        setStatus('ready');
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setStatus('error');
      }
    })();

    return () => ctrl.abort();
  }, [src]);

  // Redraw on resize once ready
  useEffect(() => {
    if (status !== 'ready') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => redraw(progressRef.current));
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [status, redraw]);

  // Playback animation loop
  useEffect(() => {
    if (!playing) return;
    const tick = () => {
      const audio = audioRef.current;
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
  }, [playing, redraw]);

  // Global mouse handlers for drag-seek
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const canvas = canvasRef.current;
      const audio = audioRef.current;
      if (!canvas || !audio) return;
      const { left, width } = canvas.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (e.clientX - left) / width));
      audio.currentTime = p * audio.duration;
      progressRef.current = p;
      setTime(p * audio.duration);
      redraw(p);
    };

    const onMouseUp = () => { isDragging.current = false; };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [redraw]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.play().catch(() => setPlaying(false));
      setPlaying(true);
    }
  };

  const onCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (status !== 'ready') return;
    const canvas = canvasRef.current;
    const audio = audioRef.current;
    if (!canvas || !audio) return;
    isDragging.current = true;
    const { left, width } = canvas.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (e.clientX - left) / width));
    audio.currentTime = p * audio.duration;
    progressRef.current = p;
    setTime(p * audio.duration);
    redraw(p);
  };

  const onVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    if (audioRef.current) audioRef.current.volume = v;
  };

  return (
    <div className="wfp">
      <audio
        ref={audioRef}
        src={src}
        onLoadedMetadata={e => setDur((e.target as HTMLAudioElement).duration)}
        onEnded={() => { setPlaying(false); progressRef.current = 0; setTime(0); redraw(0); }}
      />

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

      {/* Bottom row: volume + time (indented to align under waveform) */}
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

        <span className="wfp-time">
          <span className="wfp-time-cur">{fmt(time)}</span>
          <span className="wfp-sep">/</span>
          <span className="wfp-time-dur">{fmt(dur)}</span>
        </span>
      </div>
    </div>
  );
}
