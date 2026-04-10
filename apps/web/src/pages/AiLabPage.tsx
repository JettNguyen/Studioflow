import './AiLabPage.css';

export function AiLabPage() {
  return (
    <section>
      <div className="page-header">
        <div className="page-header__main">
          <h2>AI Lab</h2>
          <p>Model-assisted suggestions — review before applying anything to your sessions.</p>
        </div>
        <div className="page-header__aside">
          <span className="badge badge-default">Coming soon</span>
        </div>
      </div>

      <div className="card">
        <div className="ailab-placeholder">
          <div className="ailab-placeholder__icon">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <circle cx="9" cy="9" r="6.5" stroke="var(--accent-text)" strokeWidth="1.5"/>
              <path d="M6 9.5C6.5 11 7.5 12 9 12C10.5 12 11.5 11 12 9.5" stroke="var(--accent-text)" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="6.5" cy="7" r="1" fill="var(--accent-text)"/>
              <circle cx="11.5" cy="7" r="1" fill="var(--accent-text)"/>
            </svg>
          </div>
          <div className="ailab-placeholder__body">
            <h3>No suggestions yet</h3>
            <p>The backend infrastructure is ready. Features will appear here as they come online.</p>

            <div className="ailab-coming-soon">
              <div className="ailab-feature">Key and BPM detection from uploaded audio</div>
              <div className="ailab-feature">Automatic note summaries from session notes</div>
              <div className="ailab-feature">Mix consistency checks across versions</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
