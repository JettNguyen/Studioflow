export function AiLabPage() {
  return (
    <section>
      <div className="section-head">
        <div>
          <h2>AI Lab</h2>
          <p>Review model-assisted suggestions before applying anything to your sessions.</p>
        </div>
        <button className="button button-ghost" type="button" disabled>
          Coming next
        </button>
      </div>

      <article className="panel empty-panel">
        <h3>No AI suggestions yet</h3>
        <p>The backend groundwork is ready for key/BPM detection and note summaries once those jobs are wired in.</p>
      </article>
    </section>
  );
}