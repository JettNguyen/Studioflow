import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { fmtAbsolute, timeAgo } from '../lib/format';
import './NoteList.css';

export type Note = {
  id: string;
  author: string;
  body: string;
  createdAt: string;
};

type NoteListProps = {
  notes: Note[];
  draft: string;
  onDraftChange: (value: string) => void;
  onAdd: () => void | Promise<void>;
  onDelete: (noteId: string) => void | Promise<void>;
  placeholder?: string;
  emptyLabel?: string;
  busy?: boolean;
};

/** Long notes collapse to this many lines, with an explicit toggle to see the rest. */
const CLAMP_LINES = 8;

const IS_APPLE =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
const SAVE_HINT = `${IS_APPLE ? '⌘' : 'Ctrl'} + Enter to save`;

function NoteBody({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    // Only measurable while clamped — once expanded we keep the last known answer
    // so the "Show less" control doesn't vanish out from under the reader.
    if (expanded) return;
    const el = ref.current;
    if (!el) return;

    const measure = () => setOverflows(el.scrollHeight - el.clientHeight > 2);
    measure();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, expanded]);

  return (
    <>
      <p
        ref={ref}
        className={`note-item__body${expanded ? '' : ' note-item__body--clamped'}`}
        style={expanded ? undefined : { WebkitLineClamp: CLAMP_LINES }}
      >
        {text}
      </p>
      {overflows && (
        <button
          className="note-item__more"
          type="button"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </>
  );
}

export function NoteList({
  notes,
  draft,
  onDraftChange,
  onAdd,
  onDelete,
  placeholder = 'Add a note…',
  emptyLabel = 'No notes yet.',
  busy = false
}: NoteListProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Grow the composer with its content so a long note is never typed into a peephole.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  const canSubmit = draft.trim().length > 0 && !busy;

  const submit = () => {
    if (!canSubmit) return;
    void onAdd();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };

  // Newest first, regardless of the order the API happened to return.
  const ordered = [...notes].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return (
    <div className="note-panel">
      <div className="note-composer">
        <textarea
          ref={textareaRef}
          className="textarea note-composer__input"
          value={draft}
          onChange={e => onDraftChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label="Note"
        />
        <div className="note-composer__actions">
          <span className="note-composer__hint" aria-hidden="true">{SAVE_HINT}</span>
          <button
            className="btn btn-primary btn-sm"
            type="button"
            onClick={submit}
            disabled={!canSubmit}
          >
            {busy ? 'Saving…' : 'Add note'}
          </button>
        </div>
      </div>

      {ordered.length > 0 ? (
        <ul className="note-list">
          {ordered.map(note => (
            <li key={note.id} className="note-item">
              <div className="note-item__meta">
                <span className="note-item__author">{note.author}</span>
                <time
                  className="note-item__time"
                  dateTime={note.createdAt}
                  title={fmtAbsolute(note.createdAt)}
                >
                  {timeAgo(note.createdAt)}
                </time>
                <button
                  className="btn btn-ghost btn-icon note-item__delete"
                  type="button"
                  onClick={() => void onDelete(note.id)}
                  aria-label={`Delete note by ${note.author}`}
                  title="Delete note"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path d="M2 3h8M5 3V2h2v1M3 3l.5 7h5L9 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
              <NoteBody text={note.body} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="note-list__empty">{emptyLabel}</p>
      )}
    </div>
  );
}
