import { Router } from 'express';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { resolveStoredFilePath } from '../storage/localStorage.js';
import { deleteDriveFile } from '../utils/drive.js';
import {
  deleteS3Object,
  getS3Object,
  getS3ObjectWithRange,
  headS3Object,
  isS3StorageKey
} from '../storage/s3Storage.js';

export const assetRouter = Router();

const createAssetNoteSchema = z.object({
  body: z.string().min(1).max(4000)
});

assetRouter.use(requireAuth);

async function findAuthorizedAsset(assetId: string, userId: string) {
  return prisma.asset.findFirst({
    where: {
      id: assetId,
      song: {
        project: {
          memberships: {
            some: {
              userId
            }
          }
        }
      }
    }
  });
}

assetRouter.get('/:assetId/stream', async (req, res) => {
  const asset = await findAuthorizedAsset(req.params.assetId, req.user!.id);

  if (!asset || !asset.storageKey) {
    return res.status(404).json({ message: 'Asset not found' });
  }

  if (isS3StorageKey(asset.storageKey)) {
    try {
      const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;
      const head = await headS3Object(asset.storageKey);
      const object = await getS3ObjectWithRange(asset.storageKey, range);
      const body = object.Body;

      if (!body || typeof (body as NodeJS.ReadableStream).pipe !== 'function') {
        return res.status(404).json({ message: 'S3 object body not available' });
      }

      res.setHeader('Content-Type', object.ContentType || 'application/octet-stream');
      res.setHeader('Accept-Ranges', 'bytes');

      if (object.ContentRange) {
        res.status(206);
        res.setHeader('Content-Range', object.ContentRange);
      }

      const contentLength = object.ContentLength ?? head.ContentLength;
      if (typeof contentLength === 'number') {
        res.setHeader('Content-Length', contentLength.toString());
      }

      (body as NodeJS.ReadableStream).pipe(res);
      return;
    } catch {
      return res.status(404).json({ message: 'Stored file not found in S3' });
    }
  }

  const fullPath = resolveStoredFilePath(asset.storageKey);
  if (!existsSync(fullPath)) {
    return res.status(404).json({ message: 'Stored file not found on server' });
  }

  const fileSize = statSync(fullPath).size;
  const range = req.headers.range;

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
});

assetRouter.get('/:assetId/download', async (req, res) => {
  const asset = await findAuthorizedAsset(req.params.assetId, req.user!.id);

  if (!asset || !asset.storageKey) {
    return res.status(404).json({ message: 'Asset not found' });
  }

  if (isS3StorageKey(asset.storageKey)) {
    try {
      const object = await getS3Object(asset.storageKey);
      const body = object.Body;

      if (!body || typeof (body as NodeJS.ReadableStream).pipe !== 'function') {
        return res.status(404).json({ message: 'S3 object body not available' });
      }

      res.setHeader('Content-Disposition', `attachment; filename="${asset.name}"`);
      res.setHeader('Content-Type', object.ContentType || 'application/octet-stream');

      (body as NodeJS.ReadableStream).pipe(res);
      return;
    } catch {
      return res.status(404).json({ message: 'Stored file not found in S3' });
    }
  }

  const fullPath = resolveStoredFilePath(asset.storageKey);

  if (!existsSync(fullPath)) {
    return res.status(404).json({ message: 'Stored file not found on server' });
  }

  res.setHeader('Content-Disposition', `attachment; filename="${asset.name}"`);
  res.setHeader('Content-Type', 'application/octet-stream');

  createReadStream(fullPath).pipe(res);
});

assetRouter.delete('/:assetId', async (req, res) => {
  const asset = await findAuthorizedAsset(req.params.assetId, req.user!.id);

  if (!asset || !asset.storageKey) {
    return res.status(404).json({ message: 'Asset not found' });
  }

  await prisma.asset.delete({
    where: { id: asset.id }
  });

  try {
    if (asset.driveFileId) {
      const googleAccount = await prisma.oAuthAccount.findFirst({
        where: {
          userId: req.user!.id,
          provider: 'google'
        }
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
    include: {
      author: true
    }
  });

  res.status(201).json({
    id: note.id,
    author: note.author.name,
    body: note.body,
    createdAt: note.createdAt.toISOString()
  });
});
