import { Link } from 'react-router-dom';
import './Breadcrumb.css';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  // The back target is the nearest ancestor with an href
  const parent = [...items].reverse().find((item, i) => i > 0 && item.href);

  return (
    <div className="bc-bar">
      {parent?.href && (
        <Link to={parent.href} className="bc-back" aria-label={`Back to ${parent.label}`}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M9 2L4 7L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="bc-back__label">{parent.label}</span>
        </Link>
      )}

      <nav className="bc-trail" aria-label="Breadcrumb">
        <ol className="bc-trail__list">
          {items.map((item, i) => (
            <li key={i} className="bc-trail__item">
              {i > 0 && <span className="bc-trail__sep" aria-hidden="true">/</span>}
              {item.href
                ? <Link to={item.href}>{item.label}</Link>
                : <span aria-current="page">{item.label}</span>
              }
            </li>
          ))}
        </ol>
      </nav>
    </div>
  );
}
