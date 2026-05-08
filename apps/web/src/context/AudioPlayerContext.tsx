import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

export interface TrackInfo {
  /** Original URL used as identity key */
  src: string;
  /** Blob URL handed off from the WaveformPlayer — context owns its lifecycle */
  blobUrl: string;
  /** Asset/version name shown as the primary label in the player */
  title: string;
  /** Song title shown below the asset name */
  subtitle: string;
  /** Project artist name (shown in player and used for Media Session artist field) */
  artist: string;
  /** Absolute or root-relative URL for the project cover image */
  artworkUrl?: string;
  /** Route to navigate to when the bottom bar is clicked */
  pageUrl: string;
}

interface AudioPlayerContextValue {
  currentTrack: TrackInfo | null;
  playing: boolean;
  time: number;
  duration: number;
  volume: number;
  /** Ref to the single global <audio> element — never unmounts */
  audioRef: RefObject<HTMLAudioElement>;
  loadTrack: (track: TrackInfo) => void;
  toggle: () => void;
  seek: (t: number) => void;
  skip: (seconds: number) => void;
  setVolume: (v: number) => void;
  isCurrentTrack: (src: string) => boolean;
}

const AudioPlayerContext = createContext<AudioPlayerContextValue | null>(null);

export function useAudioPlayer() {
  const ctx = useContext(AudioPlayerContext);
  if (!ctx) throw new Error('useAudioPlayer must be used within AudioPlayerProvider');
  return ctx;
}

export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  // This ref points to the single <audio> element rendered below — it never unmounts,
  // so audio continues playing across route changes.
  const audioRef = useRef<HTMLAudioElement>(null!);
  const animFrameRef = useRef<number>(0);
  // Track which blob URL the context currently owns so we can revoke when swapping tracks
  const ownedBlobUrlRef = useRef<string | null>(null);

  const [currentTrack, setCurrentTrack] = useState<TrackInfo | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);

  // Drive the progress bar in PersistentPlayer via rAF when playing
  useEffect(() => {
    if (!playing) return;
    const tick = () => {
      const audio = audioRef.current;
      if (audio) {
        setTime(audio.currentTime);
        if ('mediaSession' in navigator && isFinite(audio.duration) && audio.duration > 0) {
          try {
            navigator.mediaSession.setPositionState({
              duration: audio.duration,
              position: Math.min(audio.currentTime, audio.duration),
              playbackRate: audio.playbackRate,
            });
          } catch { /* setPositionState not supported on this browser */ }
        }
      }
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [playing]);

  // ── Media Session API ────────────────────────────────────────────────────
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (!currentTrack) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
      return;
    }
    const artworkSrc = currentTrack.artworkUrl
      ? (/^https?:\/\//i.test(currentTrack.artworkUrl)
          ? currentTrack.artworkUrl
          : `${window.location.origin}${currentTrack.artworkUrl.startsWith('/') ? '' : '/'}${currentTrack.artworkUrl}`)
      : null;
    const artwork: MediaImage[] = artworkSrc
      ? [{ src: artworkSrc, sizes: '512x512' }]
      : [
          { src: `${window.location.origin}/icon-512.png`, sizes: '512x512', type: 'image/png' },
          { src: `${window.location.origin}/icon-192.png`, sizes: '192x192', type: 'image/png' },
        ];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.subtitle || currentTrack.title,
      artist: currentTrack.artist,
      album: currentTrack.artist ? currentTrack.subtitle : undefined,
      artwork,
    });
  }, [currentTrack]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  }, [playing]);

  // Register Media Session action handlers once on mount
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const audio = audioRef.current;

    const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
      play: () => { audio.play().catch(() => {}); setPlaying(true); },
      pause: () => { audio.pause(); setPlaying(false); },
      seekbackward: (d) => {
        const skip = (d as MediaSessionActionDetails).seekOffset ?? 10;
        audio.currentTime = Math.max(0, audio.currentTime - skip);
        setTime(audio.currentTime);
      },
      seekforward: (d) => {
        const skip = (d as MediaSessionActionDetails).seekOffset ?? 10;
        audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + skip);
        setTime(audio.currentTime);
      },
      seekto: (d) => {
        const t = (d as MediaSessionActionDetails).seekTime;
        if (t != null) { audio.currentTime = t; setTime(t); }
      },
    };

    for (const [action, handler] of Object.entries(handlers) as [MediaSessionAction, MediaSessionActionHandler][]) {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* unsupported */ }
    }

    return () => {
      for (const action of Object.keys(handlers) as MediaSessionAction[]) {
        try { navigator.mediaSession.setActionHandler(action, null); } catch { /* unsupported */ }
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTrack = useCallback((track: TrackInfo) => {
    const audio = audioRef.current;
    if (!audio) return;

    // Same blob URL already loaded — just start/resume playing
    if (ownedBlobUrlRef.current === track.blobUrl) {
      audio.play().catch(() => setPlaying(false));
      setPlaying(true);
      // Update metadata (title etc.) in case the user navigated and re-played
      setCurrentTrack(track);
      return;
    }

    // Revoke the old blob URL we owned (WaveformPlayer handed ownership to us)
    if (ownedBlobUrlRef.current) {
      URL.revokeObjectURL(ownedBlobUrlRef.current);
    }
    ownedBlobUrlRef.current = track.blobUrl;

    audio.src = track.blobUrl;
    audio.load();
    audio.play().catch(() => setPlaying(false));
    setCurrentTrack(track);
    setTime(0);
    setPlaying(true);
  }, []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.play().catch(() => setPlaying(false));
      setPlaying(true);
    }
  }, [playing]);

  const seek = useCallback((t: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const clamped = Math.max(0, Math.min(audio.duration || 0, t));
    audio.currentTime = clamped;
    setTime(clamped);
  }, []);

  const skip = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const t = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + seconds));
    audio.currentTime = t;
    setTime(t);
  }, []);

  const setVolume = useCallback((v: number) => {
    if (audioRef.current) audioRef.current.volume = v;
    setVolumeState(v);
  }, []);

  const isCurrentTrack = useCallback(
    (src: string) => currentTrack?.src === src,
    [currentTrack?.src],
  );

  return (
    <AudioPlayerContext.Provider
      value={{
        currentTrack,
        playing,
        time,
        duration,
        volume,
        audioRef,
        loadTrack,
        toggle,
        seek,
        skip,
        setVolume,
        isCurrentTrack,
      }}
    >
      {/* Single global audio element — lives at the app root, never unmounts */}
      <audio
        ref={audioRef}
        preload="auto"
        onLoadedMetadata={e => setDuration((e.target as HTMLAudioElement).duration)}
        onEnded={() => {
          setPlaying(false);
          setTime(0);
        }}
        style={{ display: 'none' }}
      />
      {children}
    </AudioPlayerContext.Provider>
  );
}
