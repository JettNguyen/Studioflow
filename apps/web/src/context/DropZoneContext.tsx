import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

interface DropZoneContextValue {
  /** True when files are actively being dragged over the window (desktop only) */
  isDragActive: boolean;
  /**
   * Pages that support file upload call this to register their drop handler.
   * Returns a cleanup function — call it in useEffect cleanup or on unmount.
   * Only the most recently registered handler is active at any time.
   */
  registerHandler: (handler: (files: File[]) => void) => () => void;
}

const DropZoneContext = createContext<DropZoneContextValue | null>(null);

export function useDropZone() {
  const ctx = useContext(DropZoneContext);
  if (!ctx) throw new Error('useDropZone must be used within DropZoneProvider');
  return ctx;
}

export function DropZoneProvider({ children }: { children: ReactNode }) {
  const handlerRef = useRef<((files: File[]) => void) | null>(null);
  const dragDepthRef = useRef(0);
  const [isDragActive, setIsDragActive] = useState(false);

  /** Only enable on fine-pointer (desktop) devices */
  const isDesktop = () =>
    typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches;

  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!isDesktop()) return;
      // Only react to actual file drags, not element-reorder drags (text/plain etc.)
      if (!e.dataTransfer?.types.includes('Files')) return;
      // Only show overlay if a page has registered an upload handler
      if (!handlerRef.current) return;
      e.preventDefault();
      dragDepthRef.current++;
      if (dragDepthRef.current === 1) setIsDragActive(true);
    };

    const onDragLeave = (e: DragEvent) => {
      if (!isDesktop()) return;
      if (!e.dataTransfer?.types.includes('Files')) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setIsDragActive(false);
    };

    const onDragOver = (e: DragEvent) => {
      if (!isDesktop()) return;
      if (!e.dataTransfer?.types.includes('Files')) return;
      // Must prevent default to allow drop
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };

    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragDepthRef.current = 0;
      setIsDragActive(false);

      if (!isDesktop()) return;

      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0 && handlerRef.current) {
        handlerRef.current(files);
      }
    };

    document.addEventListener('dragenter', onDragEnter);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('drop', onDrop);

    return () => {
      document.removeEventListener('dragenter', onDragEnter);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('drop', onDrop);
    };
  }, []);

  const registerHandler = useCallback((handler: (files: File[]) => void) => {
    handlerRef.current = handler;
    return () => {
      if (handlerRef.current === handler) {
        handlerRef.current = null;
      }
    };
  }, []);

  return (
    <DropZoneContext.Provider value={{ isDragActive, registerHandler }}>
      {children}
    </DropZoneContext.Provider>
  );
}
