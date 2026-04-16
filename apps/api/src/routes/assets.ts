import { Router } from 'express';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { z } from 'zod';
import { env } from '../config.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { resolveStoredFilePath } from '../storage/localStorage.js';
import { deleteDriveFile, getDriveFileStream } from '../utils/drive.js';
import {
  deleteS3Object,
  getS3ObjectWithLegacyFallback,
  getS3ObjectWithRangeLegacyFallback,
  isS3StorageKey
} from '../storage/s3Storage.js';

export const assetRouter = Router();

const createAssetNoteSchema = z.object({
  body: z.string().min(1).max(4000)
});

const updateAssetSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  category: z.enum(['Song Audio', 'Social Media Content', 'Videos', 'Beat', 'Stems']).optional(),
  versionGroup: z.string().trim().max(120).optional()
});

assetRouter.use(requireAuth);

async function findAuthorizedAsset(assetId: string, userId: string) {
  return prisma.asset.findFirst({
    where: {
      id: assetId,
      song: {
        project: {
          memberships: {
            some: { userId }
          }
        }
      }
    }
  });
}

function toPrismaAssetCategory(category: string) {
  if (category === 'Song Audio') return 'SongAudio';
  if (category === 'Social Media Content') return 'SocialMediaContent';
  if (category === 'Videos') return 'Videos';
  if (category === 'Beat') return 'Beat';
  return 'Stems';
}

function slugifyVersionGroup(value: string) {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 90);

  return slug || 'asset';
}

assetRouter.get('/:assetId/stream', async (req, res) => {
  const asset = await findAuthorizedAsset(req.params.assetId, req.user!.id);

  if (!asset || !asset.storageKey) {
    return res.status(404).json({ message: 'Asset not found' });
  }

  const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;

  // S3 path: handles both explicit s3: keys and legacy keys when S3 is enabled
  if (isS3StorageKey(asset.storageKey) || env.s3Enabled) {
    try {
      const { object } = await getS3ObjectWithRangeLegacyFallback(asset.storageKey, range);
      const body = object.Body;

      if (!body || typeof (body as NodeJS.ReadableStream).pipe !== 'function') {
        return res.status(404).json({ message: 'Asset not available in storage' });
      }

      res.setHeader('Content-Type', object.ContentType || asset.type || 'application/octet-stream');
      res.setHeader('Accept-Ranges', 'bytes');

      if (object.ContentRange) {
        res.status(206);
        res.setHeader('Content-Range', object.ContentRange);
      }

      // Only set Content-Length from the actual GET response — never from a separate HEAD
      // call, which can cause ERR_CONTENT_LENGTH_MISMATCH when range sizes don't align.
      if (typeof object.ContentLength === 'number') {
        res.setHeader('Content-Length', object.ContentLength.toString());
      }

      (body as NodeJS.ReadableStream).pipe(res);
      return;
    } catch (err) {
      if (isS3StorageKey(asset.storageKey)) {
        console.error('[S3 stream error]', asset.storageKey, err);
        return res.status(404).json({ message: 'Asset not found in storage' });
      }
      // Legacy (non-s3:) key: fall through to local / Drive
    }
  }

  // Local file path
  const fullPath = resolveStoredFilePath(asset.storageKey);
  if (existsSync(fullPath)) {
    const fileSize = statSync(fullPath).size;

    if (range) {
      const [startRaw, endRaw] = range.replace('bytes=', '').split('-');
      const start = Number.parseInt(startRaw, 10);
      const end = endRaw ? Number.parseInt(endRaw, 10) : fileSize - 1;

      if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= fileSize) {
        return res.status(416).end();
      }

      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', (end - start + 1).toString());
      res.setHeader('Content-Type', asset.type || 'application/octet-stream');
      createReadStream(fullPath, { start, end }).pipe(res);
      return;
    }

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', fileSize.toString());
    res.setHeader('Content-Type', asset.type || 'application/octet-stream');
    createReadStream(fullPath).pipe(res);
    return;
  }

  // Drive fallback
  if (asset.driveFileId) {
    try {
      const googleAccount = await prisma.oAuthAccount.findFirst({
        where: { userId: req.user!.id, provider: 'google' }
      });

      if (googleAccount) {
        const driveObject = await getDriveFileStream(googleAccount, asset.driveFileId, range);
        res.setHeader('Content-Type', driveObject.mimeType || asset.type || 'application/octet-stream');
        res.setHeader('Accept-Ranges', 'bytes');

        if (typeof driveObject.size === 'number' && Number.isFinite(driveObject.size)) {
          res.setHeader('Content-Length', driveObject.size.toString());
        }

        driveObject.stream.pipe(res);
        return;
      }
    } catch (err) {
      console.error('[Drive stream error]', asset.driveFileId, err);
    }
  }

  console.error('[Stream error] Asset not found in any location:', asset.storageKey);
  return res.status(404).json({ message: 'Asset not found in any storage location' });
});

assetRouter.get('/:assetId/download', async (req, res) => {
  const asset = await findAuthorizedAsset(req.params.assetId, req.user!.id);

  if (!asset || !asset.storageKey) {
    return res.status(404).json({ message: 'Asset not found' });
  }

  // S3 path
  if (isS3StorageKey(asset.storageKey) || env.s3Enabled) {
    try {
      const { object } = await getS3ObjectWithLegacyFallback(asset.storageKey);
      const body = object.Body;

      if (!body || typeof (body as NodeJS.ReadableStream).pipe !== 'function') {
        return res.status(404).json({ message: 'Asset not available in storage' });
      }

      res.setHeader('Content-Disposition', `attachment; filename="${asset.name}"`);
      res.setHeader('Content-Type', object.ContentType || asset.type || 'application/octet-stream');
      (body as NodeJS.ReadableStream).pipe(res);
      return;
    } catch (err) {
      if (isS3StorageKey(asset.storageKey)) {
        console.error('[S3 download error]', asset.storageKey, err);
        return res.status(404).json({ message: 'Asset not found in storage' });
      }
      // Legacy key: fall through to local / Drive
    }
  }

  // Local file path
  const fullPath = resolveStoredFilePath(asset.storageKey);
  if (existsSync(fullPath)) {
    res.setHeader('Content-Disposition', `attachment; filename="${asset.name}"`);
    res.setHeader('Content-Type', asset.type || 'application/octet-stream');
    createReadStream(fullPath).pipe(res);
    return;
  }

  // Drive fallback
  if (asset.driveFileId) {
    try {
      const googleAccount = await prisma.oAuthAccount.findFirst({
        where: { userId: req.user!.id, provider: 'google' }
      });

      if (googleAccount) {
        const driveObject = await getDriveFileStream(googleAccount, asset.driveFileId);
        res.setHeader('Content-Disposition', `attachment; filename="${asset.name}"`);
        res.setHeader('Content-Type', driveObject.mimeType || asset.type || 'application/octet-stream');
        driveObject.stream.pipe(res);
        return;
      }
    } catch (err) {
      console.error('[Drive download error]', asset.driveFileId, err);
    }
  }

  console.error('[Download error] Asset not found in any location:', asset.storageKey);
  return res.status(404).json({ message: 'Asset not found in any storage location' });
});

assetRouter.delete('/:assetId', async (req, res) => {
  const asset = await findAuthorizedAsset(req.params.assetId, req.user!.id);

  if (!asset || !asset.storageKey) {
    return res.status(404).json({ message: 'Asset not found' });
  }

  await prisma.asset.delete({ where: { id: asset.id } });

  try {
    if (asset.driveFileId) {
      const googleAccount = await prisma.oAuthAccount.findFirst({
        where: { userId: req.user!.id, provider: 'google' }
      });
      if (googleAccount) {
        await deleteDriveFile(googleAccount, asset.driveFileId);
      }
    }

    if (isS3StorageKey(asset.storageKey)) {
      await deleteS3Object(asset.storageKey);
    } else {
      const fullPath = resolveStoredFilePath(asset.storageKey);
      if (existsSync(fullPath)) {
        await unlink(fullPath);
      }
    }
  } catch {
    return res.status(202).json({ message: 'Asset removed from database but storage cleanup failed' });
  }

  res.status(204).send();
});

assetRouter.patch('/:assetId', async (req, res) => {
  const parsed = updateAssetSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid asset update payload', errors: parsed.error.flatten() });
  }

  const asset = await findAuthorizedAsset(req.params.assetId, req.user!.id);
  if (!asset) {
    return res.status(404).json({ message: 'Asset not found' });
  }

  const updates: Record<string, unknown> = {};

  if (typeof parsed.data.name === 'string') {
    updates.name = parsed.data.name;
  }

  if (typeof parsed.data.category === 'string') {
    updates.category = toPrismaAssetCategory(parsed.data.category);
  }

  if (typeof parsed.data.versionGroup === 'string') {
    updates.versionGroup = slugifyVersionGroup(parsed.data.versionGroup || asset.name);
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ message: 'No valid fields to update' });
  }

  const updated = await prisma.asset.update({
    where: { id: asset.id },
    data: updates
  });

  res.json({
    id: updated.id,
    name: updated.name,
    category: parsed.data.category,
    versionGroup: updated.versionGroup,
    updatedAt: updated.updatedAt.toISOString()
  });
});

assetRouter.post('/:assetId/notes', async (req, res) => {
  const parsed = createAssetNoteSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid note payload', errors: parsed.error.flatten() });
  }

  const asset = await findAuthorizedAsset(req.params.assetId, req.user!.id);

  if (!asset) {
    return res.status(404).json({ message: 'Asset not found' });
  }

  const note = await prisma.assetNote.create({
    data: {
      assetId: asset.id,
      authorId: req.user!.id,
      body: parsed.data.body
    },
    include: { author: true }
  });

  res.status(201).json({
    id: note.id,
    author: note.author.name,
    body: note.body,
    createdAt: note.createdAt.toISOString()
  });
});

assetRouter.delete('/:assetId/notes/:noteId', async (req, res) => {
  const asset = await findAuthorizedAsset(req.params.assetId, req.user!.id);

  if (!asset) {
    return res.status(404).json({ message: 'Asset not found' });
  }

  const note = await prisma.assetNote.findFirst({
    where: { id: req.params.noteId, assetId: asset.id }
  });

  if (!note) {
    return res.status(404).json({ message: 'Note not found' });
  }

  await prisma.assetNote.delete({ where: { id: note.id } });
  res.status(204).send();
});
