import { Router } from 'express';
import type { SongWorkspace } from '@studioflow/shared';

export const songRouter = Router();

const songs: SongWorkspace[] = [
  {
    id: 'song-1',
    title: 'Afterglow',
    key: 'D Minor',
    bpm: 124,
    assets: [
      { id: 'asset-1', name: 'Lead Vocal Main', type: 'WAV Stem', duration: '03:24' }
    ],
    notes: [
      { id: 'note-1', author: 'Jett', body: 'Need brighter vocal in pre-chorus.' }
    ],
    tasks: [
      {
        id: 'task-1',
        title: 'Print revised chorus vocal',
        assignee: 'Ari',
        status: 'Open'
      }
    ]
  }
];

songRouter.get('/:songId', (req, res) => {
  const song = songs.find((item) => item.id === req.params.songId);

  if (!song) {
    return res.status(404).json({ message: 'Song not found' });
  }

  res.json(song);
});
