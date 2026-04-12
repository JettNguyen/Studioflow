import { Router } from 'express';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import crypto from 'node:crypto';
import { z } from 'zod';
import type { CreateProjectRequest } from '@studioflow/shared';
import { prisma } from '../lib/prisma.js';
import { env } from '../config.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { resolveStoredFilePath, upload, uploadImage } from '../storage/localStorage.js';
import {
  buildS3ObjectKey,
  deleteS3Object,
  getS3Object,
  getS3ObjectWithLegacyFallback,
  getS3ObjectWithRangeLegacyFallback,
  isS3StorageKey,
  uploadFileToS3
} from '../storage/s3Storage.js';
import { createDriveFolder, ensureStudioflowProjectFolder } from '../utils/drive.js';
import { mapProjectAsset, mapProjectDetails, mapProjectSummary } from '../utils/mappers.js';

type RawProjectAsset = {
  id: string;
  projectId: string;
  name: string;
  type: string;
  category: string;
  fileSizeBytes: number | null;
  storageKey: string | null;
  createdAt: Date;
  updatedAt: Date;
};

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
          _count: { select: { songs: true, memberships: true, projectAssets: true } }
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
      },
      _count: { select: { projectAssets: true } }
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
      },
      _count: { select: { projectAssets: true } }
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
      include: {
        songs: { include: { assets: { select: { id: true } }, tasks: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
        _count: { select: { projectAssets: true } }
      }
    });
  } else {
    project = await prisma.project.update({
      where: { id: paramToString(req.params.projectId) },
      data: updates,
      include: {
        songs: { include: { assets: { select: { id: true } }, tasks: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
        _count: { select: { projectAssets: true } }
      }
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
    include: {
      songs: { include: { assets: { select: { id: true } }, tasks: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
      _count: { select: { projectAssets: true } }
    }
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
    include: {
      songs: { include: { assets: { select: { id: true } }, tasks: true }, orderBy: [ { position: 'asc' }, { createdAt: 'asc' } ] },
      _count: { select: { projectAssets: true } }
    }
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
    } catch (err) {
      console.error('[S3 cover error]', project.coverImageKey, err);
      return res.status(404).json({ message: 'Cover image not found in storage' });
    }
    return;
  }

  const fullPath = resolveStoredFilePath(project.coverImageKey);
  if (!existsSync(fullPath)) {
    if (env.s3Enabled) {
      try {
        const { object } = await getS3ObjectWithLegacyFallback(project.coverImageKey);
        res.setHeader('Content-Type', object.ContentType || 'image/jpeg');
        res.setHeader('Cache-Control', 'private, max-age=86400');
        (object.Body as NodeJS.ReadableStream).pipe(res);
        return;
      } catch {
        // Fall through to local not found response.
      }
    }

    return res.status(404).json({ message: 'Cover image not found' });
  }

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
    include: {
      songs: { include: { assets: { select: { id: true } }, tasks: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
      _count: { select: { projectAssets: true } }
    }
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

// ── Project Assets (Misc / non-song files) ────────────────────────────────────

const PROJECT_ASSET_CATEGORIES = ['Shot List', 'Filming Clip', 'Trailer Version', 'Trailer Audio', 'Other'] as const;

const updateProjectAssetSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  category: z.enum(PROJECT_ASSET_CATEGORIES).optional(),
  linkUrl: z.string().trim().url().optional()
});

function toPrismaProjectAssetCategory(category: string): string {
  if (category === 'Shot List') return 'ShotList';
  if (category === 'Filming Clip') return 'FilmingClip';
  if (category === 'Trailer Version') return 'TrailerVersion';
  if (category === 'Trailer Audio') return 'TrailerAudio';
  return 'Misc';
}

// List project misc assets
projectRouter.get('/:projectId/assets', async (req, res) => {
  const membership = await prisma.projectMembership.findFirst({
    where: { projectId: paramToString(req.params.projectId), userId: req.user!.id }
  });
  if (!membership) return res.status(404).json({ message: 'Project not found' });

  const assets = await prisma.$queryRaw<RawProjectAsset[]>`
    SELECT id, "projectId", name, type, category::text, "fileSizeBytes", "storageKey", "createdAt", "updatedAt"
    FROM "ProjectAsset"
    WHERE "projectId" = ${paramToString(req.params.projectId)}
    ORDER BY "createdAt" DESC
  `;

  res.json(assets.map(mapProjectAsset));
});

// Create a link-type project asset (no file — stores a URL, e.g. a Google Docs shot list)
projectRouter.post('/:projectId/assets/link', async (req, res) => {
  const membership = await prisma.projectMembership.findFirst({
    where: { projectId: paramToString(req.params.projectId), userId: req.user!.id }
  });
  if (!membership) return res.status(404).json({ message: 'Project not found' });

  const projectId = paramToString(req.params.projectId);
  const rawCategory = typeof req.body.category === 'string' ? req.body.category : 'Other';
  const category = PROJECT_ASSET_CATEGORIES.includes(rawCategory as typeof PROJECT_ASSET_CATEGORIES[number])
    ? rawCategory
    : 'Other';
  const prismaCategory = toPrismaProjectAssetCategory(category);

  const linkUrl = typeof req.body.linkUrl === 'string' ? req.body.linkUrl.trim() : '';
  if (!linkUrl) return res.status(400).json({ message: 'linkUrl is required' });

  // Basic URL validation
  try { new URL(linkUrl); } catch {
    return res.status(400).json({ message: 'linkUrl must be a valid URL' });
  }

  const assetName = (typeof req.body.name === 'string' && req.body.name.trim())
    ? req.body.name.trim()
    : 'Shot List';

  const storageKey = `link:${linkUrl}`;
  const id = crypto.randomUUID();
  const now = new Date();

  await prisma.$executeRaw`
    INSERT INTO "ProjectAsset" (id, "projectId", name, type, category, "fileSizeBytes", "storageKey", "createdAt", "updatedAt")
    VALUES (
      ${id},
      ${projectId},
      ${assetName},
      ${'text/uri-list'},
      ${prismaCategory}::"ProjectAssetCategory",
      ${null},
      ${storageKey},
      ${now},
      ${now}
    )
  `;

  const [created] = await prisma.$queryRaw<RawProjectAsset[]>`
    SELECT id, "projectId", name, type, category::text, "fileSizeBytes", "storageKey", "createdAt", "updatedAt"
    FROM "ProjectAsset" WHERE id = ${id}
  `;

  res.status(201).json(mapProjectAsset(created));
});

// Upload a project misc asset
projectRouter.post('/:projectId/assets', upload.single('file'), async (req, res) => {
  const membership = await prisma.projectMembership.findFirst({
    where: { projectId: paramToString(req.params.projectId), userId: req.user!.id }
  });
  if (!membership) return res.status(404).json({ message: 'Project not found' });
  if (!req.file) return res.status(400).json({ message: 'No file provided' });

  const projectId = paramToString(req.params.projectId);
  const rawCategory = typeof req.body.category === 'string' ? req.body.category : 'Other';
  const category = PROJECT_ASSET_CATEGORIES.includes(rawCategory as typeof PROJECT_ASSET_CATEGORIES[number])
    ? rawCategory
    : 'Other';
  const prismaCategory = toPrismaProjectAssetCategory(category);

  const assetName = (typeof req.body.name === 'string' && req.body.name.trim())
    ? req.body.name.trim()
    : req.file.originalname;

  const localFilePath = resolveStoredFilePath(req.file.filename);
  let storageKey: string | null = req.file.filename;
  const fileSizeBytes = req.file.size ?? null;

  try {
    if (env.s3Enabled) {
      const s3Key = buildS3ObjectKey({ userId: req.user!.id, songId: projectId, fileName: req.file.originalname });
      storageKey = await uploadFileToS3({ localFilePath, objectKey: s3Key, contentType: req.file.mimetype });
      await unlink(localFilePath).catch(() => undefined);
    }
  } catch {
    await unlink(localFilePath).catch(() => undefined);
    return res.status(500).json({ message: 'Failed to store file' });
  }

  const id = crypto.randomUUID();
  const now = new Date();

  await prisma.$executeRaw`
    INSERT INTO "ProjectAsset" (id, "projectId", name, type, category, "fileSizeBytes", "storageKey", "createdAt", "updatedAt")
    VALUES (
      ${id},
      ${projectId},
      ${assetName},
      ${req.file.mimetype},
      ${prismaCategory}::"ProjectAssetCategory",
      ${fileSizeBytes},
      ${storageKey},
      ${now},
      ${now}
    )
  `;

  const [created] = await prisma.$queryRaw<RawProjectAsset[]>`
    SELECT id, "projectId", name, type, category::text, "fileSizeBytes", "storageKey", "createdAt", "updatedAt"
    FROM "ProjectAsset" WHERE id = ${id}
  `;

  res.status(201).json(mapProjectAsset(created));
});

// Download a project misc asset
projectRouter.get('/:projectId/assets/:assetId/download', async (req, res) => {
  const membership = await prisma.projectMembership.findFirst({
    where: { projectId: paramToString(req.params.projectId), userId: req.user!.id }
  });
  if (!membership) return res.status(404).json({ message: 'Project not found' });

  const [asset] = await prisma.$queryRaw<RawProjectAsset[]>`
    SELECT id, "projectId", name, type, category::text, "fileSizeBytes", "storageKey", "createdAt", "updatedAt"
    FROM "ProjectAsset"
    WHERE id = ${paramToString(req.params.assetId)}
      AND "projectId" = ${paramToString(req.params.projectId)}
  `;

  if (!asset || !asset.storageKey) return res.status(404).json({ message: 'Asset not found' });

  // Link-type asset — redirect to the stored URL
  if (asset.storageKey.startsWith('link:')) {
    return res.redirect(asset.storageKey.slice(5));
  }

  const encodedName = encodeURIComponent(asset.name);
  res.setHeader('Content-Disposition', `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`);
  res.setHeader('Cache-Control', 'private, max-age=3600');

  if (isS3StorageKey(asset.storageKey) || env.s3Enabled) {
    try {
      const { object } = await getS3ObjectWithRangeLegacyFallback(asset.storageKey, undefined);
      res.setHeader('Content-Type', object.ContentType || asset.type || 'application/octet-stream');
      if (typeof object.ContentLength === 'number') {
        res.setHeader('Content-Length', object.ContentLength.toString());
      }
      (object.Body as NodeJS.ReadableStream).pipe(res);
      return;
    } catch {
      if (isS3StorageKey(asset.storageKey)) {
        return res.status(404).json({ message: 'File not found in storage' });
      }
    }
  }

  const fullPath = resolveStoredFilePath(asset.storageKey);
  if (!existsSync(fullPath)) return res.status(404).json({ message: 'File not found' });

  res.setHeader('Content-Type', asset.type || 'application/octet-stream');
  try {
    const stat = statSync(fullPath);
    res.setHeader('Content-Length', stat.size.toString());
  } catch { /* non-fatal */ }
  createReadStream(fullPath).pipe(res);
});

// Delete a project misc asset
projectRouter.delete('/:projectId/assets/:assetId', async (req, res) => {
  const membership = await prisma.projectMembership.findFirst({
    where: { projectId: paramToString(req.params.projectId), userId: req.user!.id }
  });
  if (!membership) return res.status(404).json({ message: 'Project not found' });

  const [asset] = await prisma.$queryRaw<RawProjectAsset[]>`
    SELECT id, "projectId", name, type, category::text, "fileSizeBytes", "storageKey", "createdAt", "updatedAt"
    FROM "ProjectAsset"
    WHERE id = ${paramToString(req.params.assetId)}
      AND "projectId" = ${paramToString(req.params.projectId)}
  `;

  if (!asset) return res.status(404).json({ message: 'Asset not found' });

  // Delete stored file
  if (asset.storageKey) {
    try {
      if (isS3StorageKey(asset.storageKey)) {
        await deleteS3Object(asset.storageKey);
      } else {
        const fullPath = resolveStoredFilePath(asset.storageKey);
        if (existsSync(fullPath)) await unlink(fullPath).catch(() => undefined);
      }
    } catch { /* non-fatal */ }
  }

  await prisma.$executeRaw`DELETE FROM "ProjectAsset" WHERE id = ${asset.id}`;

  res.status(204).send();
});

// Update a project misc asset (name/category/link URL)
projectRouter.patch('/:projectId/assets/:assetId', async (req, res) => {
  const membership = await prisma.projectMembership.findFirst({
    where: { projectId: paramToString(req.params.projectId), userId: req.user!.id }
  });
  if (!membership) return res.status(404).json({ message: 'Project not found' });

  const parsed = updateProjectAssetSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid asset update payload', errors: parsed.error.flatten() });
  }

  const [asset] = await prisma.$queryRaw<RawProjectAsset[]>`
    SELECT id, "projectId", name, type, category::text, "fileSizeBytes", "storageKey", "createdAt", "updatedAt"
    FROM "ProjectAsset"
    WHERE id = ${paramToString(req.params.assetId)}
      AND "projectId" = ${paramToString(req.params.projectId)}
  `;

  if (!asset) return res.status(404).json({ message: 'Asset not found' });

  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (typeof parsed.data.name === 'string') {
    updates.push(`name = $${idx++}`);
    values.push(parsed.data.name);
  }

  if (typeof parsed.data.category === 'string') {
    updates.push(`category = $${idx++}::"ProjectAssetCategory"`);
    values.push(toPrismaProjectAssetCategory(parsed.data.category));
  }

  if (typeof parsed.data.linkUrl === 'string') {
    if (!asset.storageKey?.startsWith('link:')) {
      return res.status(400).json({ message: 'linkUrl can only be updated for link assets' });
    }
    updates.push(`"storageKey" = $${idx++}`);
    values.push(`link:${parsed.data.linkUrl}`);
  }

  if (!updates.length) {
    return res.status(400).json({ message: 'No valid fields to update' });
  }

  updates.push(`"updatedAt" = NOW()`);

  await prisma.$executeRawUnsafe(
    `UPDATE "ProjectAsset" SET ${updates.join(', ')} WHERE id = $${idx} AND "projectId" = $${idx + 1}`,
    ...values,
    paramToString(req.params.assetId),
    paramToString(req.params.projectId)
  );

  const [updated] = await prisma.$queryRaw<RawProjectAsset[]>`
    SELECT id, "projectId", name, type, category::text, "fileSizeBytes", "storageKey", "createdAt", "updatedAt"
    FROM "ProjectAsset"
    WHERE id = ${paramToString(req.params.assetId)}
      AND "projectId" = ${paramToString(req.params.projectId)}
  `;

  if (!updated) return res.status(404).json({ message: 'Asset not found after update' });

  res.json(mapProjectAsset(updated));
});
