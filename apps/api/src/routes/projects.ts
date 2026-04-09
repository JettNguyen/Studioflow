import { Router } from 'express';
import type { ProjectDetails } from '@studioflow/shared';

export const projectRouter = Router();

const projects: ProjectDetails[] = [
  {
    id: 'proj-1',
    title: 'Neon Skyline EP',
    description: 'Main campaign project for Q2 releases.',
    driveSyncStatus: 'Healthy',
    songs: [
      {
        id: 'song-1',
        title: 'Afterglow',
        status: 'In Progress',
        assetCount: 12,
        taskOpenCount: 3
      }
    ]
  }
];

projectRouter.get('/', (_req, res) => {
  res.json(projects);
});

projectRouter.get('/:projectId', (req, res) => {
  const project = projects.find((item) => item.id === req.params.projectId);

  if (!project) {
    return res.status(404).json({ message: 'Project not found' });
  }

  res.json(project);
});
