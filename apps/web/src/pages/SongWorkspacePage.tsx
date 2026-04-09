import { useParams } from 'react-router-dom';
import { demoSongWorkspace } from '../seedData';

export function SongWorkspacePage() {
  const { songId } = useParams();
  const song = demoSongWorkspace.find((item) => item.id === songId);

  if (!song) {
    return <p>Song not found.</p>;
  }

  return (
    <section className="workspace-grid">
      <article className="panel panel-wide">
        <div className="section-head">
          <div>
            <h2>{song.title}</h2>
            <p>{song.key} | {song.bpm} BPM</p>
          </div>
          <button className="button">Upload Stem</button>
        </div>

        <ul className="asset-list">
          {song.assets.map((asset) => (
            <li key={asset.id}>
              <strong>{asset.name}</strong>
              <span>{asset.type}</span>
              <span>{asset.duration}</span>
            </li>
          ))}
        </ul>
      </article>

      <article className="panel">
        <h3>Notes</h3>
        <ul className="stack-list">
          {song.notes.map((note) => (
            <li key={note.id}>
              <strong>{note.author}</strong>
              <p>{note.body}</p>
            </li>
          ))}
        </ul>
      </article>

      <article className="panel">
        <h3>Tasks</h3>
        <ul className="stack-list">
          {song.tasks.map((task) => (
            <li key={task.id}>
              <strong>{task.title}</strong>
              <p>{task.assignee} • {task.status}</p>
            </li>
          ))}
        </ul>
      </article>
    </section>
  );
}
