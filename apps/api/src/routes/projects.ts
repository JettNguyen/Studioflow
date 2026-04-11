import { Router } from 'express';
import { createReadStream, existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { z } from 'zod';
import type { CreateProjectRequest } from '@studioflow/shared';
import { prisma } from '../lib/prisma.js';
import { env } from '../config.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { resolveStoredFilePath, uploadImage } from '../storage/localStorage.js';
import { buildS3ObjectKey, deleteS3Object, getS3Object, isS3StorageKey, uploadFileToS3 } from '../storage/s3Storage.js';
import { createDriveFolder, ensureStudioflowProjectFolder } from '../utils/drive.js';
import { mapProjectDetails, mapProjectSummary } from '../utils/mappers.js';

export const projectRouter = Router();
const paramToString = (v: string | string[] | undefined) => Array.isArray(v) ? v[0] : (v ?? '');
const createProjectSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(1000).optional().default(''),
  genre: z.string().min(1).max(80).optional().default('Unspecified')
});

projectRouter.use(requireAuth);

projectRouter.get('/', async (req, res) => {
  const memberships = await prisma.projectMembership.findMany({
    where: { userId: req.user!.id },
    select: {
      project: {
        select: {
          id: true,
          title: true,
          description: true,
          genre: true,
          released: true,
          coverImageKey: true,
          driveSyncStatus: true,
          _count: { select: { songs: true, memberships: true } }
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  res.json(memberships.map(m => mapProjectSummary(m.project)));
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

  const project = await prisma.project.create({
    data: {
      title: parsed.data.title,
      description: parsed.data.description,
      genre: parsed.data.genre,
      createdById: req.user!.id,
      driveFolderId: null,
      driveSyncStatus: googleAccount ? 'NeedsAttention' : 'NotLinked',
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
          assets: { select: { id: true } },
          tasks: true
        }
      }
    }
  });

  res.status(201).json(mapProjectDetails(project));

  // Fire-and-forget: create Drive folder after responding so the client isn't blocked
  if (googleAccount) {
    ensureStudioflowProjectFolder(googleAccount, parsed.data.title)
      .then((folderId) => {
        if (folderId) {
          return prisma.project.update({
            where: { id: project.id },
            data: { driveFolderId: folderId, driveSyncStatus: 'Healthy' }
          });
        }
      })
      .catch(() => { /* will be repaired on next sync-drive-all */ });
  }
});

projectRouter.get('/:projectId', async (req, res) => {
  const project = await prisma.project.findFirst({
    where: {
      id: paramToString(req.params.projectId),
      memberships: { some: { userId: req.user!.id } }
    },
    include: {
      songs: {
        include: {
          assets: { select: { id: true } },
          tasks: true
        },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }]
      }
    }
  });

  if (!project) return res.status(404).json({ message: 'Project not found' });

  res.json(mapProjectDetails(project));
});

// Update project fields (e.g. title, description, genre)
projectRouter.patch('/:projectId', async (req, res) => {
  const body = req.body as Partial<{ title: string; description: string; genre: string; released?: boolean }>;

  const membership = await prisma.projectMembership.findFirst({
    where: { projectId: paramToString(req.params.projectId), userId: req.user!.id }
  });

  if (!membership) return res.status(404).json({ message: 'Project not found' });

  const updates: Record<string, unknown> = {};
  if (typeof body.title === 'string' && body.title.trim().length > 0) updates.title = body.title.trim();
  if (typeof body.description === 'string') updates.description = body.description;
  if (typeof body.genre === 'string' && body.genre.trim().length > 0) updates.genre = body.genre.trim();
  if (typeof body.released === 'boolean') updates.released = body.released;

  if (Object.keys(updates).length === 0) return res.status(400).json({ message: 'No valid fields to update' });

  // Prisma client may not have been regenerated yet after schema changes.
  // If `released` is present, perform a raw SQL update for that column to avoid validation errors,
  // then remove it from the `updates` object and continue with the normal update/fetch flow.
  if (typeof updates.released !== 'undefined') {
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE "Project" SET "released" = ${updates.released ? 'TRUE' : 'FALSE'} WHERE "id" = '${paramToString(req.params.projectId)}'`
      );
    } catch {
      // non-fatal; continue to attempt the higher-level update below
    }
    delete updates.released;
  }

  let project;
  if (Object.keys(updates).length === 0) {
    project = await prisma.project.findUnique({
      where: { id: paramToString(req.params.projectId) },
      include: { songs: { include: { assets: { select: { id: true } }, tasks: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } }
    });
  } else {
    project = await prisma.project.update({
      where: { id: paramToString(req.params.projectId) },
      data: updates,
      include: { songs: { include: { assets: { select: { id: true } }, tasks: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } }
    });
  }

  if (!project) return res.status(404).json({ message: 'Project not found after update' });

  res.json(mapProjectDetails(project));
});

// Background Drive sync: called on app load to repair any broken folders.
// Silently creates missing project/song folders for all user projects.
// Returns a summary — never throws, so the frontend can fire-and-forget.
projectRouter.post('/sync-drive-all', async (req, res) => {
  const googleAccount = await prisma.oAuthAccount.findFirst({
    where: { userId: req.user!.id, provider: 'google' }
  });

  // If no Drive connection there's nothing to fix
  if (!googleAccount) {
    return res.json({ synced: 0, failed: 0 });
  }

  const memberships = await prisma.projectMembership.findMany({
    where: { userId: req.user!.id },
    include: {
      project: {
        include: {
          songs: { select: { id: true, title: true, driveFolderId: true } }
        }
      }
    }
  });

  let synced = 0;
  let failed = 0;

  for (const { project } of memberships) {
    // ── Project folder ────────────────────────────────────────────────
    let projectFolderId = project.driveFolderId;

    if (!projectFolderId || project.driveSyncStatus === 'NeedsAttention') {
      try {
        projectFolderId = await ensureStudioflowProjectFolder(googleAccount, project.title);
        if (projectFolderId) {
          await prisma.project.update({
              where: { id: project.id },
              data: { driveFolderId: projectFolderId, driveSyncStatus: 'Healthy' }
            });
          synced++;
        } else {
          failed++;
          continue;
        }
      } catch {
        failed++;
        continue;
      }
    }

    // ── Song folders within this project ─────────────────────────────
    for (const song of project.songs) {
      if (!song.driveFolderId) {
        try {
          const songFolderId = await createDriveFolder(googleAccount, song.title, projectFolderId);
          if (songFolderId) {
            await prisma.song.update({
              where: { id: song.id },
              data: { driveFolderId: songFolderId }
            });
            synced++;
          }
        } catch {
          // Non-fatal — song folder creation can fail without blocking
        }
      }
    }
  }

  res.json({ synced, failed });
});

// Retry Drive folder creation for a project that has NeedsAttention status
projectRouter.post('/:projectId/sync-drive', async (req, res) => {
  const membership = await prisma.projectMembership.findFirst({
    where: { projectId: paramToString(req.params.projectId), userId: req.user!.id }
  });
  if (!membership) return res.status(404).json({ message: 'Project not found' });

  const googleAccount = await prisma.oAuthAccount.findFirst({
    where: { userId: req.user!.id, provider: 'google' }
  });

  if (!googleAccount) {
    return res.status(400).json({ message: 'No Google account connected. Connect Drive first.' });
  }

  const project = await prisma.project.findUnique({ where: { id: paramToString(req.params.projectId) } });
  if (!project) return res.status(404).json({ message: 'Project not found' });

  let driveFolderId: string | null = project.driveFolderId;
  let driveSyncStatus: 'NotLinked' | 'Healthy' | 'NeedsAttention' = 'NeedsAttention';

  try {
    driveFolderId = await ensureStudioflowProjectFolder(googleAccount, project.title);
    driveSyncStatus = driveFolderId ? 'Healthy' : 'NeedsAttention';
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Drive sync failed';
    return res.status(502).json({ message: msg });
  }

  const updated = await prisma.project.update({
    where: { id: paramToString(req.params.projectId) },
    data: { driveFolderId, driveSyncStatus },
    include: { songs: { include: { assets: { select: { id: true } }, tasks: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } }
  });

  res.json(mapProjectDetails(updated));
});

// Reorder songs within a project. Expects { order: string[] } with song IDs in desired order.
projectRouter.post('/:projectId/songs/reorder', async (req, res) => {
  const payload = req.body as { order?: string[] } | undefined;
  if (!payload?.order || !Array.isArray(payload.order)) {
    return res.status(400).json({ message: 'Invalid payload' });
  }

  const membership = await prisma.projectMembership.findFirst({
    where: { projectId: paramToString(req.params.projectId), userId: req.user!.id }
  });
  if (!membership) return res.status(404).json({ message: 'Project not found' });

  // Fetch current songs for the project to validate
  const songs = await prisma.song.findMany({ where: { projectId: paramToString(req.params.projectId) }, select: { id: true } });
  const idsSet = new Set(songs.map((s) => s.id));

  if (payload.order.length !== songs.length || payload.order.some((id) => !idsSet.has(id))) {
    return res.status(400).json({ message: 'Order must include all songs from the project' });
  }

  // Apply positions in a transaction
  const updates = payload.order.map((id, idx) => prisma.song.update({ where: { id }, data: { position: idx } }));

  await prisma.$transaction(updates);

  // Return updated project
  const project = await prisma.project.findUnique({
    where: { id: paramToString(req.params.projectId) },
    include: { songs: { include: { assets: { select: { id: true } }, tasks: true }, orderBy: [ { position: 'asc' }, { createdAt: 'asc' } ] } }
  });

  if (!project) return res.status(404).json({ message: 'Project not found after reorder' });

  res.json(mapProjectDetails(project));
});

// ── Cover image ───────────────────────────────────────────────────────────────

projectRouter.get('/:projectId/cover', async (req, res) => {
  const membership = await prisma.projectMembership.findFirst({
    where: { projectId: paramToString(req.params.projectId), userId: req.user!.id }
  });
  if (!membership) return res.status(404).json({ message: 'Project not found' });

  const project = await prisma.project.findUnique({ where: { id: paramToString(req.params.projectId) } });
  if (!project?.coverImageKey) return res.status(404).json({ message: 'No cover image' });

  if (isS3StorageKey(project.coverImageKey)) {
    try {
      const obj = await getS3Object(project.coverImageKey);
      res.setHeader('Content-Type', obj.ContentType || 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      (obj.Body as NodeJS.ReadableStream).pipe(res);
    } catch {
      return res.status(404).json({ message: 'Cover image not found in storage' });
    }
    return;
  }

  const fullPath = resolveStoredFilePath(project.coverImageKey);
  if (!existsSync(fullPath)) return res.status(404).json({ message: 'Cover image not found' });

  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  createReadStream(fullPath).pipe(res);
});

projectRouter.post('/:projectId/cover', uploadImage.single('image'), async (req, res) => {
  const membership = await prisma.projectMembership.findFirst({
    where: { projectId: paramToString(req.params.projectId), userId: req.user!.id }
  });
  if (!membership) return res.status(404).json({ message: 'Project not found' });
  if (!req.file) return res.status(400).json({ message: 'No image file provided' });

  const project = await prisma.project.findUnique({ where: { id: paramToString(req.params.projectId) } });

  const localFilePath = resolveStoredFilePath(req.file.filename);
  let storageKey = req.file.filename;

  try {
    if (env.s3Enabled) {
      const s3Key = buildS3ObjectKey({ userId: req.user!.id, songId: paramToString(req.params.projectId), fileName: req.file.originalname });
      storageKey = await uploadFileToS3({ localFilePath, objectKey: s3Key, contentType: req.file.mimetype });
      await unlink(localFilePath).catch(() => undefined);
    }
  } catch {
    await unlink(localFilePath).catch(() => undefined);
    return res.status(500).json({ message: 'Failed to store cover image' });
  }

  // Delete previous cover if it exists
  if (project?.coverImageKey) {
    try {
      if (isS3StorageKey(project.coverImageKey)) {
        await deleteS3Object(project.coverImageKey);
      } else {
        const prev = resolveStoredFilePath(project.coverImageKey);
        if (existsSync(prev)) await unlink(prev).catch(() => undefined);
      }
    } catch { /* non-fatal */ }
  }

  const updated = await prisma.project.update({
    where: { id: paramToString(req.params.projectId) },
    data: { coverImageKey: storageKey },
    include: { songs: { include: { assets: { select: { id: true } }, tasks: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } }
  });

  res.json(mapProjectDetails(updated));
});

projectRouter.delete('/:projectId/cover', async (req, res) => {
  const membership = await prisma.projectMembership.findFirst({
    where: { projectId: paramToString(req.params.projectId), userId: req.user!.id }
  });
  if (!membership) return res.status(404).json({ message: 'Project not found' });

  const project = await prisma.project.findUnique({ where: { id: paramToString(req.params.projectId) } });
  if (!project?.coverImageKey) return res.status(204).send();

  try {
    if (isS3StorageKey(project.coverImageKey)) {
      await deleteS3Object(project.coverImageKey);
    } else {
      const fullPath = resolveStoredFilePath(project.coverImageKey);
      if (existsSync(fullPath)) await unlink(fullPath).catch(() => undefined);
    }
  } catch { /* non-fatal */ }

  await prisma.project.update({ where: { id: paramToString(req.params.projectId) }, data: { coverImageKey: null } });
  res.status(204).send();
});
