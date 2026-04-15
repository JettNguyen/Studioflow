import { useDropZone } from '../context/DropZoneContext';
import './DragDropOverlay.css';

export function DragDropOverlay() {
  const { isDragActive } = useDropZone();

  return (
    <div className={`ddo${isDragActive ? ' ddo--active' : ''}`} aria-hidden="true">
      <div className="ddo__inner">
        <div className="ddo__icon">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
            <rect x="4" y="4" width="40" height="40" rx="8" stroke="currentColor" strokeWidth="2" strokeDasharray="6 4" />
            <path
              d="M24 14v14M17 21l7-7 7 7"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M14 34h20"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              opacity="0.5"
            />
          </svg>
        </div>
        <p className="ddo__label">Drop files to upload</p>
      </div>
    </div>
  );
}
