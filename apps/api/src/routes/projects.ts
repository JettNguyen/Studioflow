import { Router } from 'express';
import { z } from 'zod';
import type { CreateProjectRequest } from '@studioflow/shared';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { ensureStudioflowProjectFolder } from '../utils/drive.js';
import { mapProjectDetails, mapProjectSummary } from '../utils/mappers.js';

export const projectRouter = Router();
const createProjectSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(1000).optional().default(''),
  genre: z.string().min(1).max(80).optional().default('Unspecified')
});

projectRouter.use(requireAuth);

projectRouter.get('/', async (req, res) => {
  const memberships = await prisma.projectMembership.findMany({
    where: { userId: req.user!.id },
    include: {
      project: {
        include: {
          memberships: true,
          songs: true
        }
      }
    },
    orderBy: {
      createdAt: 'desc'
    }
  });

  res.json(memberships.map((membership) => mapProjectSummary(membership.project)));
});

projectRouter.post('/', async (req, res) => {
  const parsed = createProjectSchema.safeParse(req.body satisfies CreateProjectRequest);

  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid project payload', errors: parsed.error.flatten() });
  }

  const googleAccount = await prisma.oAuthAccount.findFirst({
    where: {
      userId: req.user!.id,
      provider: 'google'
    }
  });

  let driveFolderId: string | null = null;
  let driveSyncStatus: 'NotLinked' | 'Healthy' | 'NeedsAttention' = googleAccount ? 'Healthy' : 'NotLinked';

  if (googleAccount) {
    try {
      driveFolderId = await ensureStudioflowProjectFolder(googleAccount, parsed.data.title);
      if (!driveFolderId) {
        driveSyncStatus = 'NeedsAttention';
      }
    } catch {
      driveSyncStatus = 'NeedsAttention';
    }
  }

  const project = await prisma.project.create({
    data: {
      title: parsed.data.title,
      description: parsed.data.description,
      genre: parsed.data.genre,
      createdById: req.user!.id,
      driveFolderId,
      driveSyncStatus,
      memberships: {
        create: {
          userId: req.user!.id,
          role: 'Owner'
        }
      }
    },
    include: {
      songs: {
        include: {
          assets: true,
          tasks: true
        }
      }
    }
  });

  res.status(201).json(mapProjectDetails(project));
});

projectRouter.get('/:projectId', async (req, res) => {
  const membership = await prisma.projectMembership.findFirst({
    where: {
      projectId: req.params.projectId,
      userId: req.user!.id
    }
  });

  if (!membership) {
    return res.status(404).json({ message: 'Project not found' });
  }

  const project = await prisma.project.findUnique({
    where: { id: req.params.projectId },
    include: {
      songs: {
        include: {
          assets: true,
          tasks: true
        },
        orderBy: {
          createdAt: 'asc'
        }
      }
    }
  });

  if (!project) {
    return res.status(404).json({ message: 'Project not found' });
  }

  res.json(mapProjectDetails(project));
});
