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
  getS3ObjectWithLegacyFallback,
  getS3ObjectWithRangeLegacyFallback,
  isS3StorageKey,
  uploadFileToS3
} from '../storage/s3Storage.js';
import {
  createDriveFolder,
  deleteDriveFile,
  ensureStudioflowProjectFolder,
  ensureProjectFilesFolder,
  ensureProjectFilesCategoryFolder,
  getDriveFileStream,
  uploadDriveFile
} from '../utils/drive.js';
import { mapProjectAsset, mapProjectDetails, mapProjectSummary } from '../utils/mappers.js';

type RawProjectAsset = {
  id: string;
  projectId: string;
  name: string;
  type: string;
  category: string;
  versionGroup: string;
  versionNumber: number;
  fileSizeBytes: number | null;
  storageKey: string | null;
  driveFileId?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type RawProjectAssetNote = {
  id: string;
  assetId: string;
  body: string;
  createdAt: Date;
  authorName: string;
};

function isMissingDbObjectError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybe = error as { code?: string; meta?: { code?: string } };
  return maybe.code === 'P2010' && (maybe.meta?.code === '42703' || maybe.meta?.code === '42P01');
}

async function loadProjectAssetNotes(assetIds: string[]) {
  if (!assetIds.length) return new Map<string, Array<{ id: string; body: string; createdAt: Date; author: { name: string } }>>();

  let notes: RawProjectAssetNote[] = [];
  try {
    notes = await prisma.$queryRaw<RawProjectAssetNote[]>`
      SELECT n.id, n."assetId", n.body, n."createdAt", u.name as "authorName"
      FROM "ProjectAssetNote" n
      INNER JOIN "User" u ON u.id = n."authorId"
      WHERE n."assetId" = ANY(${assetIds})
      ORDER BY n."createdAt" ASC
    `;
  } catch (error) {
    if (isMissingDbObjectError(error)) {
      return new Map();
    }
    throw error;
  }

  const byAssetId = new Map<string, Array<{ id: string; body: string; createdAt: Date; author: { name: string } }>>();
  for (const note of notes) {
    const current = byAssetId.get(note.assetId) ?? [];
    current.push({
      id: note.id,
      body: note.body,
      createdAt: note.createdAt,
      author: { name: note.authorName }
    });
    byAssetId.set(note.assetId, current);
  }
  return byAssetId;
}

function slugifyVersionGroup(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120) || 'file';
}

function isDriveStorageKey(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith('drive:');
}

function parseDriveFileId(storageKey: string | null | undefined): string | null {
  if (!isDriveStorageKey(storageKey)) return null;
  const id = storageKey.slice('drive:'.length).trim();
  return id || null;
}

async function findDriveAccountsForProject(userId: string, projectId: string, ownerId: string) {
  const memberships = await prisma.projectMembership.findMany({
    where: { projectId },
    select: { userId: true }
  });

  const orderedIds = Array.from(new Set([userId, ownerId, ...memberships.map((m) => m.userId)]));
  const accounts = await prisma.oAuthAccount.findMany({
    where: {
      provider: 'google',
      userId: { in: orderedIds },
      refreshToken: { not: null }
    }
  });

  const byUserId = new Map(accounts.map((a) => [a.userId, a]));
  return orderedIds
    .map((id) => byUserId.get(id))
    .filter((account): account is (typeof accounts)[number] => Boolean(account));
}

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

  const driveFileId = parseDriveFileId(project.coverImageKey);
  if (driveFileId) {
    const accounts = await findDriveAccountsForProject(req.user!.id, project.id, project.createdById);
    for (const account of accounts) {
      try {
        const driveObject = await getDriveFileStream(account, driveFileId);
        res.setHeader('Content-Type', driveObject.mimeType || 'image/jpeg');
        res.setHeader('Cache-Control', 'private, max-age=86400');
        driveObject.stream.pipe(res);
        return;
      } catch (err) {
        console.error('[Drive cover error]', project.coverImageKey, account.userId, err);
      }
    }

    return res.status(404).json({ message: 'Cover image not found' });
  }

  // Prefer S3 when enabled, even for legacy/plain keys, to keep covers
  // available across devices/sessions where local files may be absent.
  if (env.s3Enabled) {
    try {
      const { object, resolvedStorageKey } = await getS3ObjectWithLegacyFallback(project.coverImageKey);

      // Self-heal cover key to canonical s3: form when a legacy candidate matches.
      if (resolvedStorageKey !== project.coverImageKey) {
        void prisma.project.update({
          where: { id: project.id },
          data: { coverImageKey: resolvedStorageKey }
        }).catch(() => undefined);
      }

      res.setHeader('Content-Type', object.ContentType || 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      (object.Body as NodeJS.ReadableStream).pipe(res);
      return;
    } catch (err) {
      console.error('[S3 cover error]', project.coverImageKey, err);
      // Fall through to local lookup for local-only historical covers.
    }
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
  if (!project) return res.status(404).json({ message: 'Project not found' });

  const localFilePath = resolveStoredFilePath(req.file.filename);
  let storageKey = req.file.filename;
  let driveFileId: string | null = null;

  const driveAccounts = await findDriveAccountsForProject(req.user!.id, project.id, project.createdById);
  let projectDriveFolderId = project.driveFolderId;

  if (!env.s3Enabled && env.nodeEnv === 'production' && !driveAccounts.length) {
    await unlink(localFilePath).catch(() => undefined);
    return res.status(503).json({
      message: 'Cover image persistence requires either object storage or a connected Google Drive account.'
    });
  }

  if (!projectDriveFolderId && driveAccounts.length) {
    for (const account of driveAccounts) {
      try {
        projectDriveFolderId = await ensureStudioflowProjectFolder(account, project.title);
        if (projectDriveFolderId) {
          await prisma.project.update({
            where: { id: project.id },
            data: { driveFolderId: projectDriveFolderId, driveSyncStatus: 'Healthy' }
          });
          break;
        }
      } catch {
        // Try next account.
      }
    }
  }

  try {
    if (env.s3Enabled) {
      const s3Key = buildS3ObjectKey({ userId: req.user!.id, songId: paramToString(req.params.projectId), fileName: req.file.originalname });
      storageKey = await uploadFileToS3({ localFilePath, objectKey: s3Key, contentType: req.file.mimetype });
    }

    if (projectDriveFolderId && driveAccounts.length) {
      for (const account of driveAccounts) {
        try {
          driveFileId = await uploadDriveFile(account, {
            localFilePath,
            name: `cover-${project.id}-${Date.now()}-${req.file.originalname}`,
            mimeType: req.file.mimetype,
            parentFolderId: projectDriveFolderId
          });
          if (driveFileId) break;
        } catch {
          // Try next account.
        }
      }

      if (!driveFileId && !env.s3Enabled) {
        throw new Error('Drive cover upload failed');
      }
    }
  } catch {
    if (env.s3Enabled && isS3StorageKey(storageKey)) {
      await deleteS3Object(storageKey).catch(() => undefined);
    }
    await unlink(localFilePath).catch(() => undefined);
    return res.status(500).json({ message: 'Failed to store cover image' });
  }

  await unlink(localFilePath).catch(() => undefined);

  // Delete previous cover if it exists
  if (project?.coverImageKey) {
    try {
      const previousDriveFileId = parseDriveFileId(project.coverImageKey);
      if (previousDriveFileId) {
        for (const account of driveAccounts) {
          try {
            await deleteDriveFile(account, previousDriveFileId);
            break;
          } catch {
            // Try next account.
          }
        }
      } else if (isS3StorageKey(project.coverImageKey)) {
        await deleteS3Object(project.coverImageKey);
      } else {
        const prev = resolveStoredFilePath(project.coverImageKey);
        if (existsSync(prev)) await unlink(prev).catch(() => undefined);
      }
    } catch { /* non-fatal */ }
  }

  const updated = await prisma.project.update({
    where: { id: paramToString(req.params.projectId) },
    data: { coverImageKey: env.s3Enabled ? storageKey : (driveFileId ? `drive:${driveFileId}` : storageKey) },
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

  const driveAccounts = await findDriveAccountsForProject(req.user!.id, project.id, project.createdById);

  try {
    const driveFileId = parseDriveFileId(project.coverImageKey);
    if (driveFileId) {
      for (const account of driveAccounts) {
        try {
          await deleteDriveFile(account, driveFileId);
          break;
        } catch {
          // Try next account.
        }
      }
    } else if (isS3StorageKey(project.coverImageKey)) {
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

const updateProjectAssetSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  category: z.string().trim().min(1).max(80).optional(),
  linkUrl: z.string().trim().url().optional()
});

function sanitizeCategory(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return 'Other';
  return raw.trim().slice(0, 80);
}

// List project misc assets
projectRouter.get('/:projectId/assets', async (req, res) => {
  const membership = await prisma.projectMembership.findFirst({
    where: { projectId: paramToString(req.params.projectId), userId: req.user!.id }
  });
  if (!membership) return res.status(404).json({ message: 'Project not found' });

  const assets = await prisma.$queryRaw<RawProjectAsset[]>`
    SELECT id, "projectId", name, type, category, "versionGroup", "versionNumber", "fileSizeBytes", "storageKey", "driveFileId", "createdAt", "updatedAt"
    FROM "ProjectAsset"
    WHERE "projectId" = ${paramToString(req.params.projectId)}
    ORDER BY "createdAt" DESC
  `;

  const notesByAssetId = await loadProjectAssetNotes(assets.map(a => a.id));
  res.json(assets.map(a => mapProjectAsset({ ...a, notes: notesByAssetId.get(a.id) ?? [] })));
});

// Create a link-type project asset (no file — stores a URL, e.g. a Google Docs shot list)
projectRouter.post('/:projectId/assets/link', async (req, res) => {
  const membership = await prisma.projectMembership.findFirst({
    where: { projectId: paramToString(req.params.projectId), userId: req.user!.id }
  });
  if (!membership) return res.status(404).json({ message: 'Project not found' });

  const projectId = paramToString(req.params.projectId);
  const category = sanitizeCategory(req.body.category);

  const linkUrl = typeof req.body.linkUrl === 'string' ? req.body.linkUrl.trim() : '';
  if (!linkUrl) return res.status(400).json({ message: 'linkUrl is required' });

  try { new URL(linkUrl); } catch {
    return res.status(400).json({ message: 'linkUrl must be a valid URL' });
  }

  const assetName = (typeof req.body.name === 'string' && req.body.name.trim())
    ? req.body.name.trim()
    : 'Shot List';

  const versionGroup = slugifyVersionGroup(assetName);
  const [prevVersion] = await prisma.$queryRaw<{ versionNumber: number }[]>`
    SELECT "versionNumber" FROM "ProjectAsset"
    WHERE "projectId" = ${projectId} AND "versionGroup" = ${versionGroup}
    ORDER BY "versionNumber" DESC LIMIT 1
  `;
  const versionNumber = prevVersion ? prevVersion.versionNumber + 1 : 1;

  const storageKey = `link:${linkUrl}`;
  const id = crypto.randomUUID();
  const now = new Date();

  await prisma.$executeRaw`
    INSERT INTO "ProjectAsset" (id, "projectId", name, type, category, "versionGroup", "versionNumber", "fileSizeBytes", "storageKey", "createdAt", "updatedAt")
    VALUES (${id}, ${projectId}, ${assetName}, ${'text/uri-list'}, ${category}, ${versionGroup}, ${versionNumber}, ${null}, ${storageKey}, ${now}, ${now})
  `;

  const [created] = await prisma.$queryRaw<RawProjectAsset[]>`
    SELECT id, "projectId", name, type, category, "versionGroup", "versionNumber", "fileSizeBytes", "storageKey", "createdAt", "updatedAt"
    FROM "ProjectAsset" WHERE id = ${id}
  `;

  res.status(201).json(mapProjectAsset({ ...created, notes: [] }));
});

// Upload a project misc asset
projectRouter.post('/:projectId/assets', upload.single('file'), async (req, res) => {
  const membership = await prisma.projectMembership.findFirst({
    where: { projectId: paramToString(req.params.projectId), userId: req.user!.id }
  });
  if (!membership) return res.status(404).json({ message: 'Project not found' });
  if (!req.file) return res.status(400).json({ message: 'No file provided' });

  const projectId = paramToString(req.params.projectId);
  const category = sanitizeCategory(req.body.category);

  const assetName = (typeof req.body.name === 'string' && req.body.name.trim())
    ? req.body.name.trim()
    : req.file.originalname;

  const versionGroup = slugifyVersionGroup(assetName);
  const [prevVersion] = await prisma.$queryRaw<{ versionNumber: number }[]>`
    SELECT "versionNumber" FROM "ProjectAsset"
    WHERE "projectId" = ${projectId} AND "versionGroup" = ${versionGroup}
    ORDER BY "versionNumber" DESC LIMIT 1
  `;
  const versionNumber = prevVersion ? prevVersion.versionNumber + 1 : 1;

  const localFilePath = resolveStoredFilePath(req.file.filename);
  let storageKey: string | null = req.file.filename;
  let driveFileId: string | null = null;
  const fileSizeBytes = req.file.size ?? null;

  const uploadProject = await prisma.project.findUnique({
    where: { id: projectId },
    select: { driveFolderId: true, createdById: true, title: true }
  });

  const driveAccounts = uploadProject
    ? await findDriveAccountsForProject(req.user!.id, projectId, uploadProject.createdById)
    : [];

  let projectDriveFolderId = uploadProject?.driveFolderId ?? null;
  if (!projectDriveFolderId && uploadProject && driveAccounts.length) {
    for (const account of driveAccounts) {
      try {
        projectDriveFolderId = await ensureStudioflowProjectFolder(account, uploadProject.title);
        if (projectDriveFolderId) {
          await prisma.project.update({
            where: { id: projectId },
            data: { driveFolderId: projectDriveFolderId, driveSyncStatus: 'Healthy' }
          });
          break;
        }
      } catch {
        // Try next account.
      }
    }
  }

  if (!env.s3Enabled && !driveAccounts.length) {
    await unlink(localFilePath).catch(() => undefined);
    return res.status(503).json({
      message: 'No durable upload backend is currently available. Connect Google Drive or enable S3 storage and retry.'
    });
  }

  if (projectDriveFolderId && driveAccounts.length) {
    for (const account of driveAccounts) {
      try {
        const projectFilesFolderId = await ensureProjectFilesFolder(account, projectDriveFolderId);
        if (!projectFilesFolderId) {
          continue;
        }
        const targetFolderId = await ensureProjectFilesCategoryFolder(account, category, projectFilesFolderId);
        driveFileId = await uploadDriveFile(account, {
          localFilePath,
          name: assetName,
          mimeType: req.file.mimetype,
          parentFolderId: targetFolderId
        });
        if (driveFileId) break;
      } catch {
        // Try next account.
      }
    }

    if (!driveFileId) {
      await unlink(localFilePath).catch(() => undefined);
      return res.status(502).json({ message: 'Failed to upload file to Google Drive' });
    }
  }

  try {
    if (env.s3Enabled) {
      const s3Key = buildS3ObjectKey({ userId: req.user!.id, songId: projectId, fileName: req.file.originalname });
      storageKey = await uploadFileToS3({ localFilePath, objectKey: s3Key, contentType: req.file.mimetype });
    }
  } catch {
    await unlink(localFilePath).catch(() => undefined);
    return res.status(500).json({ message: 'Failed to store file' });
  }

  if (env.s3Enabled || driveFileId) {
    await unlink(localFilePath).catch(() => undefined);
  }

  const id = crypto.randomUUID();
  const now = new Date();

  await prisma.$executeRaw`
    INSERT INTO "ProjectAsset" (id, "projectId", name, type, category, "versionGroup", "versionNumber", "fileSizeBytes", "storageKey", "driveFileId", "createdAt", "updatedAt")
    VALUES (${id}, ${projectId}, ${assetName}, ${req.file.mimetype}, ${category}, ${versionGroup}, ${versionNumber}, ${fileSizeBytes}, ${env.s3Enabled ? storageKey : null}, ${driveFileId}, ${now}, ${now})
  `;

  const [created] = await prisma.$queryRaw<RawProjectAsset[]>`
    SELECT id, "projectId", name, type, category, "versionGroup", "versionNumber", "fileSizeBytes", "storageKey", "driveFileId", "createdAt", "updatedAt"
    FROM "ProjectAsset" WHERE id = ${id}
  `;

  res.status(201).json(mapProjectAsset({ ...created, notes: [] }));
});

// Download a project misc asset
projectRouter.get('/:projectId/assets/:assetId/download', async (req, res) => {
  const membership = await prisma.projectMembership.findFirst({
    where: { projectId: paramToString(req.params.projectId), userId: req.user!.id }
  });
  if (!membership) return res.status(404).json({ message: 'Project not found' });

  const [asset] = await prisma.$queryRaw<RawProjectAsset[]>`
    SELECT id, "projectId", name, type, category, "versionGroup", "versionNumber", "fileSizeBytes", "storageKey", "driveFileId", "createdAt", "updatedAt"
    FROM "ProjectAsset"
    WHERE id = ${paramToString(req.params.assetId)}
      AND "projectId" = ${paramToString(req.params.projectId)}
  `;

  if (!asset || !asset.storageKey) return res.status(404).json({ message: 'Asset not found' });

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

  if (asset.driveFileId) {
    const project = await prisma.project.findUnique({
      where: { id: paramToString(req.params.projectId) },
      select: { createdById: true }
    });

    if (project) {
      const accounts = await findDriveAccountsForProject(req.user!.id, paramToString(req.params.projectId), project.createdById);
      for (const account of accounts) {
        try {
          const driveObject = await getDriveFileStream(account, asset.driveFileId);
          res.setHeader('Content-Type', driveObject.mimeType || asset.type || 'application/octet-stream');
          if (typeof driveObject.contentLength === 'number') {
            res.setHeader('Content-Length', driveObject.contentLength.toString());
          } else if (typeof driveObject.size === 'number') {
            res.setHeader('Content-Length', driveObject.size.toString());
          }
          driveObject.stream.pipe(res);
          return;
        } catch {
          // Try next account.
        }
      }
    }
  }

  if (!asset.storageKey) return res.status(404).json({ message: 'File not found' });
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
    SELECT id, "projectId", name, type, category, "versionGroup", "versionNumber", "fileSizeBytes", "storageKey", "driveFileId", "createdAt", "updatedAt"
    FROM "ProjectAsset"
    WHERE id = ${paramToString(req.params.assetId)}
      AND "projectId" = ${paramToString(req.params.projectId)}
  `;

  if (!asset) return res.status(404).json({ message: 'Asset not found' });

  if (asset.driveFileId || (asset.storageKey && !asset.storageKey.startsWith('link:'))) {
    try {
      if (asset.driveFileId) {
        const project = await prisma.project.findUnique({
          where: { id: paramToString(req.params.projectId) },
          select: { createdById: true }
        });
        if (project) {
          const accounts = await findDriveAccountsForProject(req.user!.id, paramToString(req.params.projectId), project.createdById);
          for (const account of accounts) {
            try {
              await deleteDriveFile(account, asset.driveFileId);
              break;
            } catch {
              // Try next account.
            }
          }
        }
      }

      if (asset.storageKey) {
        if (isS3StorageKey(asset.storageKey)) {
          await deleteS3Object(asset.storageKey);
        } else {
          const fullPath = resolveStoredFilePath(asset.storageKey);
          if (existsSync(fullPath)) await unlink(fullPath).catch(() => undefined);
        }
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
    SELECT id, "projectId", name, type, category, "versionGroup", "versionNumber", "fileSizeBytes", "storageKey", "driveFileId", "createdAt", "updatedAt"
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
    updates.push(`category = $${idx++}`);
    values.push(parsed.data.category.trim().slice(0, 80));
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
    SELECT id, "projectId", name, type, category, "versionGroup", "versionNumber", "fileSizeBytes", "storageKey", "driveFileId", "createdAt", "updatedAt"
    FROM "ProjectAsset"
    WHERE id = ${paramToString(req.params.assetId)}
      AND "projectId" = ${paramToString(req.params.projectId)}
  `;

  if (!updated) return res.status(404).json({ message: 'Asset not found after update' });

  const notesByAssetId = await loadProjectAssetNotes([updated.id]);
  res.json(mapProjectAsset({ ...updated, notes: notesByAssetId.get(updated.id) ?? [] }));
});

// ── Project Asset Notes ───────────────────────────────────────────────────────

projectRouter.post('/:projectId/assets/:assetId/notes', async (req, res) => {
  const membership = await prisma.projectMembership.findFirst({
    where: { projectId: paramToString(req.params.projectId), userId: req.user!.id }
  });
  if (!membership) return res.status(404).json({ message: 'Project not found' });

  const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
  if (!body) return res.status(400).json({ message: 'Note body is required' });

  const [asset] = await prisma.$queryRaw<RawProjectAsset[]>`
    SELECT id, "projectId"
    FROM "ProjectAsset"
    WHERE id = ${paramToString(req.params.assetId)}
      AND "projectId" = ${paramToString(req.params.projectId)}
  `;
  if (!asset) return res.status(404).json({ message: 'Asset not found' });

  const noteId = crypto.randomUUID();
  const now = new Date();
  await prisma.$executeRaw`
    INSERT INTO "ProjectAssetNote" (id, "assetId", "authorId", body, "createdAt", "updatedAt")
    VALUES (${noteId}, ${asset.id}, ${req.user!.id}, ${body}, ${now}, ${now})
  `;

  res.status(201).json({ id: noteId, author: req.user!.name, body, createdAt: now.toISOString() });
});

projectRouter.delete('/:projectId/assets/:assetId/notes/:noteId', async (req, res) => {
  const membership = await prisma.projectMembership.findFirst({
    where: { projectId: paramToString(req.params.projectId), userId: req.user!.id }
  });
  if (!membership) return res.status(404).json({ message: 'Project not found' });

  const [note] = await prisma.$queryRaw<Array<{ id: string; authorId: string }>>`
    SELECT n.id, n."authorId"
    FROM "ProjectAssetNote" n
    INNER JOIN "ProjectAsset" a ON a.id = n."assetId"
    WHERE n.id = ${paramToString(req.params.noteId)}
      AND n."assetId" = ${paramToString(req.params.assetId)}
      AND a."projectId" = ${paramToString(req.params.projectId)}
  `;
  if (!note) return res.status(404).json({ message: 'Note not found' });

  if (note.authorId !== req.user!.id && membership.role === 'Viewer') {
    return res.status(403).json({ message: 'Not authorized to delete this note' });
  }

  await prisma.$executeRaw`DELETE FROM "ProjectAssetNote" WHERE id = ${note.id}`;
  res.status(204).send();
});
