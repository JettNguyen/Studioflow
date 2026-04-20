import { Router } from 'express';
import { readFile, unlink } from 'node:fs/promises';
import { parseFile as parseAudioFileMetadata } from 'music-metadata';
import { z } from 'zod';
import type {
  CreateNoteRequest,
  CreateSongRequest,
  CreateTaskRequest,
  UpdateTaskStatusRequest
} from '@studioflow/shared';
import { prisma } from '../lib/prisma.js';
import { env } from '../config.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { resolveStoredFilePath, upload } from '../storage/localStorage.js';
import { buildS3ObjectKey, deleteS3Object, uploadFileToS3 } from '../storage/s3Storage.js';
import {
  createDriveFolder,
  ensureSongCategoryFolder,
  initiateDriveResumableUpload,
  setDriveFilePublicRead,
  uploadDriveFile,
  uploadDriveResumableChunk
} from '../utils/drive.js';

const CHUNK_SIZE_BYTES = 2 * 1024 * 1024;
import { mapSongWorkspace } from '../utils/mappers.js';

export const songRouter = Router();
const paramToString = (v: string | string[] | undefined) => Array.isArray(v) ? v[0] : (v ?? '');
const createSongSchema = z.object({
  title: z.string().min(1).max(120),
  status: z.string().max(60).optional(),
  key: z.string().max(30).optional(),
  bpm: z.number().int().positive().max(400).optional()
});

const createNoteSchema = z.object({
  body: z.string().min(1).max(4000)
});

const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  assigneeUserId: z.string().optional()
});

const updateTaskStatusSchema = z.object({
  status: z.enum(['Open', 'In Review', 'Done'])
});

const uploadAssetMetadataSchema = z.object({
  category: z.enum(['Song Audio', 'Social Media Content', 'Videos', 'Beat', 'Stems']).default('Song Audio'),
  versionGroup: z.string().max(120).optional()
});

function toPrismaAssetCategory(category: string) {
  if (category === 'Song Audio') {
    return 'SongAudio';
  }

  if (category === 'Social Media Content') {
    return 'SocialMediaContent';
  }

  if (category === 'Videos') {
    return 'Videos';
  }

  if (category === 'Beat') {
    return 'Beat';
  }

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

function readNativeTextTag(metadata: { native?: Record<string, Array<{ id?: string; value?: unknown }>> }, tagIds: string[]) {
  if (!metadata.native) {
    return null;
  }

  for (const tags of Object.values(metadata.native)) {
    for (const tag of tags) {
      if (!tag.id || !tagIds.includes(tag.id)) {
        continue;
      }

      const value = tag.value;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) {
          return trimmed;
        }
      }

      if (Array.isArray(value)) {
        const first = value.find((item) => typeof item === 'string' && item.trim().length > 0);
        if (typeof first === 'string') {
          return first.trim();
        }
      }
    }
  }

  return null;
}

function parseBpmFromText(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.round(parsed);
}

async function findDriveUploadAccountsForSong(userId: string, projectId: string, ownerId: string) {
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

songRouter.use(requireAuth);

songRouter.post('/project/:projectId', async (req, res) => {
  const parsed = createSongSchema.safeParse(req.body satisfies CreateSongRequest);

  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid song payload', errors: parsed.error.flatten() });
  }

  const membership = await prisma.projectMembership.findFirst({
    where: {
      userId: req.user!.id,
      projectId: paramToString(req.params.projectId)
    },
    include: {
      project: true
    }
  });

  if (!membership) {
    return res.status(404).json({ message: 'Project not found' });
  }

  // Determine position: append to end by finding current max position
  const maxPos = await prisma.song.findFirst({
    where: { projectId: paramToString(req.params.projectId) },
    orderBy: { position: 'desc' }
  });

  const nextPosition = (maxPos?.position ?? -1) + 1;

  const song = await prisma.song.create({
    data: {
      projectId: paramToString(req.params.projectId),
      title: parsed.data.title,
      status: parsed.data.status ?? 'Draft',
      position: nextPosition,
      keySignature: parsed.data.key,
      bpm: parsed.data.bpm,
      driveFolderId: null
    },
    include: {
      assets: {
        include: {
          notes: {
            include: {
              author: true
            },
            orderBy: {
              createdAt: 'desc'
            }
          }
        }
      },
      notes: {
        include: { author: true }
      },
      tasks: {
        include: { assignee: true }
      }
    }
  });

  res.status(201).json(mapSongWorkspace(song, membership.project.title));

  // Fire-and-forget: create Drive folder after responding so the client isn't blocked
  if (membership.project.driveFolderId) {
    prisma.oAuthAccount.findFirst({ where: { userId: req.user!.id, provider: 'google' } })
      .then((googleAccount) => {
        if (!googleAccount) return;
        return createDriveFolder(googleAccount, parsed.data.title, membership.project.driveFolderId!)
          .then((folderId) => {
            if (folderId) {
              return prisma.song.update({ where: { id: song.id }, data: { driveFolderId: folderId } });
            }
          });
      })
      .catch(() => { /* will be repaired on next sync-drive-all */ });
  }
});

songRouter.get('/:songId', async (req, res) => {
  const song = await prisma.song.findFirst({
    where: {
      id: req.params.songId,
      project: {
        memberships: {
          some: {
            userId: req.user!.id
          }
        }
      }
    },
    include: {
      project: { select: { title: true } },
      assets: {
        include: {
          notes: {
            include: {
              author: true
            },
            orderBy: {
              createdAt: 'desc'
            }
          }
        }
      },
      notes: {
        include: {
          author: true
        },
        orderBy: {
          createdAt: 'desc'
        }
      },
      tasks: {
        include: {
          assignee: true
        },
        orderBy: {
          createdAt: 'desc'
        }
      }
    }
  });

  if (!song) {
    return res.status(404).json({ message: 'Song not found' });
  }

  res.json(mapSongWorkspace(song, song.project.title));
});

const updateSongSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  lyrics: z.string().max(100000).nullable().optional(),
  key: z.string().max(30).nullable().optional(),
  bpm: z.number().int().positive().max(400).nullable().optional(),
  released: z.boolean().optional(),
  shotListUrl: z.string().url().max(2048).nullable().optional()
});

songRouter.patch('/:songId', async (req, res) => {
  const parsed = updateSongSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid payload', errors: parsed.error.flatten() });
  }

  const membership = await prisma.projectMembership.findFirst({
    where: {
      userId: req.user!.id,
      project: { songs: { some: { id: req.params.songId } } }
    }
  });
  if (!membership) return res.status(404).json({ message: 'Song not found' });

  const song = await prisma.song.update({
    where: { id: req.params.songId },
    data: {
      ...(parsed.data.title !== undefined && { title: parsed.data.title.trim() }),
      ...(parsed.data.lyrics !== undefined && { lyrics: parsed.data.lyrics }),
      ...(parsed.data.key !== undefined && { keySignature: parsed.data.key }),
      ...(parsed.data.bpm !== undefined && { bpm: parsed.data.bpm }),
    },
    include: {
      assets: { include: { notes: { include: { author: true }, orderBy: { createdAt: 'desc' } } } },
      notes: { include: { author: true }, orderBy: { createdAt: 'desc' } },
      tasks: { include: { assignee: true }, orderBy: { createdAt: 'desc' } },
    }
  });

  // Handle fields not yet reflected in the generated Prisma client via raw SQL.
  const rawUpdates: string[] = [];
  let releasedValue: boolean = Boolean((song as any).released);
  let shotListUrlValue: string | null = (song as any).shotListUrl ?? null;

  if (parsed.data.released !== undefined) {
    rawUpdates.push(`"released" = ${parsed.data.released ? 'TRUE' : 'FALSE'}`);
    releasedValue = parsed.data.released;
  }
  // Track manual overrides: setting a value marks it manual; clearing it resets to auto.
  if (parsed.data.key !== undefined) {
    rawUpdates.push(`"keyManuallySet" = ${parsed.data.key !== null ? 'TRUE' : 'FALSE'}`);
  }
  if (parsed.data.bpm !== undefined) {
    rawUpdates.push(`"bpmManuallySet" = ${parsed.data.bpm !== null ? 'TRUE' : 'FALSE'}`);
  }
  if (rawUpdates.length > 0) {
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE "Song" SET ${rawUpdates.join(', ')} WHERE "id" = '${req.params.songId}'`
      );
    } catch { /* non-fatal */ }
  }

  // shotListUrl uses a parameterized raw query to safely handle user-supplied URLs.
  if (parsed.data.shotListUrl !== undefined) {
    try {
      const urlVal: string | null = parsed.data.shotListUrl;
      await prisma.$executeRaw`UPDATE "Song" SET "shotListUrl" = ${urlVal} WHERE "id" = ${req.params.songId}`;
      shotListUrlValue = urlVal;
    } catch { /* non-fatal */ }
  }

  // Build response from the update result — no extra round-trip needed.
  // Merge the raw-SQL-applied values we just set.
  res.json(mapSongWorkspace(Object.assign({}, song, { released: releasedValue, shotListUrl: shotListUrlValue })));
});

songRouter.delete('/:songId', async (req, res) => {
  const membership = await prisma.projectMembership.findFirst({
    where: {
      userId: req.user!.id,
      project: { songs: { some: { id: req.params.songId } } }
    }
  });
  if (!membership) return res.status(404).json({ message: 'Song not found' });

  await prisma.song.delete({ where: { id: req.params.songId } });
  res.status(204).send();
});

songRouter.post('/:songId/notes', async (req, res) => {
  const parsed = createNoteSchema.safeParse(req.body satisfies CreateNoteRequest);

  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid note payload', errors: parsed.error.flatten() });
  }

  const song = await prisma.song.findFirst({
    where: {
      id: req.params.songId,
      project: {
        memberships: {
          some: {
            userId: req.user!.id
          }
        }
      }
    }
  });

  if (!song) {
    return res.status(404).json({ message: 'Song not found' });
  }

  const note = await prisma.note.create({
    data: {
      songId: req.params.songId,
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

songRouter.post('/:songId/tasks', async (req, res) => {
  const parsed = createTaskSchema.safeParse(req.body satisfies CreateTaskRequest);

  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid task payload', errors: parsed.error.flatten() });
  }

  const song = await prisma.song.findFirst({
    where: {
      id: req.params.songId,
      project: {
        memberships: {
          some: {
            userId: req.user!.id
          }
        }
      }
    }
  });

  if (!song) {
    return res.status(404).json({ message: 'Song not found' });
  }

  const task = await prisma.task.create({
    data: {
      songId: req.params.songId,
      title: parsed.data.title,
      assigneeId: parsed.data.assigneeUserId,
      createdById: req.user!.id
    },
    include: {
      assignee: true
    }
  });

  res.status(201).json({
    id: task.id,
    title: task.title,
    assignee: task.assignee?.name ?? null,
    status: task.status === 'InReview' ? 'In Review' : task.status
  });
});

songRouter.delete('/:songId/notes/:noteId', async (req, res) => {
  const note = await prisma.note.findFirst({
    where: {
      id: req.params.noteId,
      songId: req.params.songId,
      song: {
        project: {
          memberships: { some: { userId: req.user!.id } }
        }
      }
    }
  });
  if (!note) return res.status(404).json({ message: 'Note not found' });
  await prisma.note.delete({ where: { id: req.params.noteId } });
  res.status(204).send();
});

songRouter.delete('/:songId/tasks/:taskId', async (req, res) => {
  const task = await prisma.task.findFirst({
    where: {
      id: req.params.taskId,
      songId: req.params.songId,
      song: {
        project: {
          memberships: { some: { userId: req.user!.id } }
        }
      }
    }
  });
  if (!task) return res.status(404).json({ message: 'Task not found' });
  await prisma.task.delete({ where: { id: req.params.taskId } });
  res.status(204).send();
});

songRouter.patch('/:songId/tasks/:taskId', async (req, res) => {
  const parsed = updateTaskStatusSchema.safeParse(req.body satisfies UpdateTaskStatusRequest);

  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid task status payload', errors: parsed.error.flatten() });
  }

  const task = await prisma.task.findFirst({
    where: {
      id: req.params.taskId,
      songId: req.params.songId,
      song: {
        project: {
          memberships: {
            some: {
              userId: req.user!.id
            }
          }
        }
      }
    },
    include: {
      assignee: true
    }
  });

  if (!task) {
    return res.status(404).json({ message: 'Task not found' });
  }

  const prismaStatus =
    parsed.data.status === 'In Review'
      ? 'InReview'
      : parsed.data.status;

  const updatedTask = await prisma.task.update({
    where: { id: task.id },
    data: {
      status: prismaStatus
    },
    include: {
      assignee: true
    }
  });

  res.json({
    id: updatedTask.id,
    title: updatedTask.title,
    assignee: updatedTask.assignee?.name ?? null,
    status: updatedTask.status === 'InReview' ? 'In Review' : updatedTask.status
  });
});

songRouter.post('/:songId/assets/upload-chunk', upload.single('file'), async (req, res) => {
  const songId = paramToString(req.params.songId);
  if (!req.file) return res.status(400).json({ message: 'No chunk provided' });

  const chunkIndex     = parseInt(req.body.chunkIndex    ?? '0', 10);
  const totalChunks    = parseInt(req.body.totalChunks   ?? '1', 10);
  const totalSizeBytes = parseInt(req.body.totalSizeBytes ?? '0', 10);
  const mimeType       = typeof req.body.mimeType === 'string' ? req.body.mimeType.trim() : req.file.mimetype;
  const incomingSessionUri = typeof req.body.driveSessionUri === 'string' ? req.body.driveSessionUri.trim() : null;
  const localChunkPath = resolveStoredFilePath(req.file.filename);

  const song = await prisma.song.findFirst({
    where: { id: songId, project: { memberships: { some: { userId: req.user!.id } } } },
    include: { project: { select: { createdById: true } } }
  });
  if (!song) {
    await unlink(localChunkPath).catch(() => undefined);
    return res.status(404).json({ message: 'Song not found' });
  }

  try {
    let driveSessionUri = incomingSessionUri;

    if (!driveSessionUri) {
      if (!song.driveFolderId) {
        await unlink(localChunkPath).catch(() => undefined);
        return res.status(503).json({ message: 'This song is not linked to Google Drive. Open the song settings and connect Google Drive first.' });
      }

      const driveAccounts = await findDriveUploadAccountsForSong(req.user!.id, song.projectId, song.project.createdById);
      if (!driveAccounts.length) {
        await unlink(localChunkPath).catch(() => undefined);
        return res.status(503).json({ message: 'No Google Drive account is linked.' });
      }

      const category = typeof req.body.category === 'string' ? req.body.category : 'Song Audio';
      const userProvidedName = (req.body.name as string | undefined)?.trim() || '';
      const assetDisplayName = userProvidedName || (category === 'Song Audio' ? song.title : req.file.originalname);

      let sessionUri: string | null = null;
      for (const account of driveAccounts) {
        try {
          const categoryFolderId = await ensureSongCategoryFolder(account, category, song.driveFolderId);
          sessionUri = await initiateDriveResumableUpload(account, { name: assetDisplayName, mimeType, parentFolderId: categoryFolderId });
          if (sessionUri) break;
        } catch { /* try next */ }
      }
      if (!sessionUri) {
        await unlink(localChunkPath).catch(() => undefined);
        return res.status(502).json({ message: 'Failed to initiate Google Drive upload session.' });
      }
      driveSessionUri = sessionUri;
    }

    const chunkBuffer = await readFile(localChunkPath);
    await unlink(localChunkPath).catch(() => undefined);
    const startByte = chunkIndex * CHUNK_SIZE_BYTES;
    const isLastChunk = chunkIndex === totalChunks - 1;

    const result = await uploadDriveResumableChunk(driveSessionUri, chunkBuffer, startByte, totalSizeBytes, mimeType);

    if (result.complete) {
      const fileId = result.fileId;
      const driveAccounts2 = await findDriveUploadAccountsForSong(req.user!.id, song.projectId, song.project.createdById);
      for (const account of driveAccounts2) {
        try { await setDriveFilePublicRead(account, fileId); break; } catch { /* non-fatal */ }
      }

      const parsedMeta = uploadAssetMetadataSchema.safeParse({ category: req.body.category, versionGroup: req.body.versionGroup });
      const category = parsedMeta.success ? parsedMeta.data.category : 'Song Audio';
      const prismaCategory = toPrismaAssetCategory(category);
      const userProvidedName = (req.body.name as string | undefined)?.trim() || '';
      const inputAssetName = userProvidedName || (category === 'Song Audio' ? song.title : req.file?.originalname ?? 'upload');
      const vgRaw = parsedMeta.success ? parsedMeta.data.versionGroup : undefined;
      const versionGroup = slugifyVersionGroup(vgRaw || inputAssetName);

      const previousVersion = await prisma.asset.findFirst({ where: { songId, versionGroup }, orderBy: { versionNumber: 'desc' } });
      const nextVersionNumber = previousVersion ? previousVersion.versionNumber + 1 : 1;

      const clientDuration = (req.body.duration as string | undefined)?.trim() || null;
      const clientKey      = (req.body.detectedKey as string | undefined)?.trim() || null;
      const clientBpm      = (() => { const v = parseInt((req.body.detectedBpm as string | undefined) ?? '', 10); return Number.isFinite(v) && v > 0 ? v : null; })();

      const asset = await prisma.asset.create({
        data: {
          songId,
          name: inputAssetName,
          type: mimeType,
          category: prismaCategory,
          versionGroup,
          versionNumber: nextVersionNumber,
          duration: clientDuration,
          fileSizeBytes: totalSizeBytes || null,
          storageKey: null,
          driveFileId: fileId
        }
      });

      if (prismaCategory === 'SongAudio' && (clientKey || clientBpm)) {
        const flags = await prisma.$queryRawUnsafe<Array<{ keyManuallySet: boolean; bpmManuallySet: boolean }>>(
          `SELECT "keyManuallySet", "bpmManuallySet" FROM "Song" WHERE "id" = $1`, songId
        );
        const keyManuallySet = flags[0]?.keyManuallySet ?? false;
        const bpmManuallySet = flags[0]?.bpmManuallySet ?? false;
        const cols: string[] = [];
        if (clientKey && !keyManuallySet) cols.push(`"keySignature" = '${clientKey.replace(/'/g, "''")}'`);
        if (clientBpm && !bpmManuallySet) cols.push(`"bpm" = ${clientBpm}`);
        if (cols.length > 0) await prisma.$executeRawUnsafe(`UPDATE "Song" SET ${cols.join(', ')} WHERE "id" = '${songId}'`);
      }

      const mediaKind = mimeType.startsWith('video/') ? 'video' : mimeType.startsWith('audio/') ? 'audio' : 'other';
      return res.status(201).json({
        id: asset.id, name: asset.name, type: asset.type, category,
        versionGroup: asset.versionGroup, versionNumber: asset.versionNumber,
        duration: asset.duration, sampleRateHz: null, bitrateKbps: null, codec: null,
        channels: null, fileSizeBytes: asset.fileSizeBytes, container: null,
        mediaKind, streamUrl: `/api/assets/${asset.id}/stream`, downloadUrl: `/api/assets/${asset.id}/download`,
        createdAt: asset.createdAt.toISOString(), notes: []
      });
    }

    if (!isLastChunk) return res.json({ driveSessionUri });
    return res.status(502).json({ message: 'Drive did not confirm completion on the final chunk.' });

  } catch (err) {
    await unlink(localChunkPath).catch(() => undefined);
    console.error('[song upload-chunk error]', err);
    return res.status(500).json({ message: 'Failed to upload chunk to Google Drive.' });
  }
});

songRouter.post('/:songId/assets', upload.single('file'), async (req, res) => {
  const songId = Array.isArray(req.params.songId) ? req.params.songId[0] : req.params.songId;

  const song = await prisma.song.findFirst({
    where: {
      id: songId,
      project: {
        memberships: {
          some: {
            userId: req.user!.id
          }
        }
      }
    },
    include: {
      project: {
        select: { createdById: true }
      }
    }
  });

  if (!song) {
    return res.status(404).json({ message: 'Song not found' });
  }

  if (!req.file) {
    return res.status(400).json({ message: 'Missing file upload payload (expected field "file")' });
  }

  const parsedMetadata = uploadAssetMetadataSchema.safeParse({
    category: req.body.category,
    versionGroup: req.body.versionGroup
  });

  if (!parsedMetadata.success) {
    return res.status(400).json({ message: 'Invalid asset metadata payload', errors: parsedMetadata.error.flatten() });
  }

  const userProvidedName = (req.body.name as string | undefined)?.trim() || '';
  // If song audio has no explicit asset name, default to the song title.
  // This keeps the asset name aligned with the song folder/title naming.
  const inputAssetName = userProvidedName.length > 0
    ? userProvidedName
    : parsedMetadata.data.category === 'Song Audio'
      ? song.title
      : req.file.originalname;
  const versionGroup = slugifyVersionGroup(parsedMetadata.data.versionGroup || inputAssetName);
  const prismaCategory = toPrismaAssetCategory(parsedMetadata.data.category);

  const previousVersion = await prisma.asset.findFirst({
    where: {
      songId,
      versionGroup
    },
    orderBy: {
      versionNumber: 'desc'
    }
  });

  const nextVersionNumber = previousVersion ? previousVersion.versionNumber + 1 : 1;

  const driveUploadAccounts = song.driveFolderId
    ? await findDriveUploadAccountsForSong(req.user!.id, song.projectId, song.project.createdById)
    : [];

  const localFilePath = resolveStoredFilePath(req.file.filename);
  let storageKey = req.file.filename;
  let driveFileId: string | null = null;
  let inferredDuration = (req.body.duration as string | undefined)?.trim() || null;
  let inferredKey: string | null = null;
  let inferredBpm: number | null = null;
  let inferredSampleRateHz: number | null = null;
  let inferredBitrateKbps: number | null = null;
  let inferredCodec: string | null = null;
  let inferredChannels: number | null = null;
  let inferredContainer: string | null = null;
  const inferredFileSizeBytes = Number.isFinite(req.file.size) ? req.file.size : null;

  if (req.file.mimetype.startsWith('audio/')) {
    try {
      const metadata = await parseAudioFileMetadata(localFilePath);

      if (!inferredDuration && metadata.format.duration && Number.isFinite(metadata.format.duration)) {
        const totalSeconds = Math.round(metadata.format.duration);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        inferredDuration = `${minutes}:${String(seconds).padStart(2, '0')}`;
      }

      if (metadata.common.key) {
        inferredKey = metadata.common.key;
      }

      if (!inferredKey) {
        inferredKey = readNativeTextTag(metadata, ['TKEY', 'KEY', 'INITIALKEY', 'INITIAL_KEY']);
      }

      if (metadata.common.bpm && Number.isFinite(metadata.common.bpm)) {
        inferredBpm = Math.round(metadata.common.bpm);
      }

      if (!inferredBpm) {
        inferredBpm = parseBpmFromText(readNativeTextTag(metadata, ['TBPM', 'BPM', 'TEMPO']));
      }

      inferredSampleRateHz = Number.isFinite(metadata.format.sampleRate)
        ? Number(metadata.format.sampleRate)
        : null;

      inferredBitrateKbps = Number.isFinite(metadata.format.bitrate)
        ? Math.round(Number(metadata.format.bitrate) / 1000)
        : null;

      inferredCodec = metadata.format.codec?.trim() || null;
      inferredChannels = Number.isFinite(metadata.format.numberOfChannels)
        ? Number(metadata.format.numberOfChannels)
        : null;
      inferredContainer = metadata.format.container?.trim() || null;
    } catch {
      // Continue even if metadata extraction fails.
    }
  }

  // First, attempt S3 upload if enabled. If this fails, abort and return 500.
  if (env.s3Enabled && req.file.path) {
    try {
      const s3Key = buildS3ObjectKey({
        userId: req.user!.id,
        songId,
        fileName: req.file.originalname
      });

      storageKey = await uploadFileToS3({
        localFilePath,
        objectKey: s3Key,
        contentType: req.file.mimetype
      });
    } catch (err) {
      await unlink(localFilePath).catch(() => undefined);
      return res.status(500).json({ message: 'Failed to upload file to storage backend' });
    }
  }

  const shouldUploadToDrive = Boolean(song.driveFolderId && driveUploadAccounts.length > 0);

  if (!env.s3Enabled && !shouldUploadToDrive) {
    await unlink(localFilePath).catch(() => undefined);
    return res.status(503).json({
      message: 'No durable upload backend is currently available. Connect Google Drive or enable S3 storage and retry.'
    });
  }
  const driveFolderId = song.driveFolderId;
  if (shouldUploadToDrive && driveFolderId) {
    for (const googleAccount of driveUploadAccounts) {
      try {
        const categoryFolderId = await ensureSongCategoryFolder(
          googleAccount,
          parsedMetadata.data.category,
          driveFolderId
        );

        driveFileId = await uploadDriveFile(googleAccount, {
          localFilePath,
          name: `${inputAssetName} (v${nextVersionNumber})`,
          mimeType: req.file.mimetype,
          parentFolderId: categoryFolderId
        });

        if (driveFileId) {
          break;
        }
      } catch (driveErr) {
        console.error('Drive upload attempt failed for asset', {
          songId,
          uploaderUserId: googleAccount.userId,
          file: req.file.originalname,
          err: driveErr
        });
      }
    }

    if (!driveFileId) {
      if (env.s3Enabled && storageKey) {
        await deleteS3Object(storageKey).catch(() => undefined);
      }
      await unlink(localFilePath).catch(() => undefined);
      return res.status(502).json({ message: 'Failed to upload file to Google Drive' });
    }
  }

  if (env.s3Enabled || driveFileId) {
    await unlink(localFilePath).catch(() => undefined);
  }

  const asset = await prisma.asset.create({
    data: {
      songId,
      name: inputAssetName,
      type: req.file.mimetype || 'application/octet-stream',
      category: prismaCategory,
      versionGroup,
      versionNumber: nextVersionNumber,
      duration: inferredDuration,
      sampleRateHz: inferredSampleRateHz,
      bitrateKbps: inferredBitrateKbps,
      codec: inferredCodec,
      channels: inferredChannels,
      fileSizeBytes: inferredFileSizeBytes,
      container: inferredContainer,
      storageKey: env.s3Enabled ? storageKey : null,
      driveFileId
    }
  });

  if (prismaCategory === 'SongAudio') {
    // Prefer tag-extracted values; fall back to client-side detected values sent in form body.
    const finalKey = inferredKey
      || ((req.body.detectedKey as string | undefined)?.trim() || null);
    const finalBpm = inferredBpm
      || (() => {
        const v = parseInt((req.body.detectedBpm as string | undefined) ?? '', 10);
        return Number.isFinite(v) && v > 0 ? v : null;
      })();

    if (finalKey || finalBpm) {
      // Read manual-override flags — columns added via db push, use raw SQL to avoid
      // Prisma client regeneration requirement while the dev server is running.
      const flags = await prisma.$queryRawUnsafe<Array<{ keyManuallySet: boolean; bpmManuallySet: boolean }>>(
        `SELECT "keyManuallySet", "bpmManuallySet" FROM "Song" WHERE "id" = $1`, songId
      );
      const keyManuallySet = flags[0]?.keyManuallySet ?? false;
      const bpmManuallySet = flags[0]?.bpmManuallySet ?? false;

      const updateCols: string[] = [];
      if (finalKey && !keyManuallySet) updateCols.push(`"keySignature" = '${finalKey.replace(/'/g, "''")}'`);
      if (finalBpm && !bpmManuallySet) updateCols.push(`"bpm" = ${finalBpm}`);

      if (updateCols.length > 0) {
        await prisma.$executeRawUnsafe(
          `UPDATE "Song" SET ${updateCols.join(', ')} WHERE "id" = '${songId}'`
        );
      }
    }
  }

  const mediaKind = asset.type.startsWith('video/')
    ? 'video'
    : asset.type.startsWith('audio/')
      ? 'audio'
      : 'other';

  res.status(201).json({
    id: asset.id,
    name: asset.name,
    type: asset.type,
    category: parsedMetadata.data.category,
    versionGroup: asset.versionGroup,
    versionNumber: asset.versionNumber,
    duration: asset.duration,
    sampleRateHz: asset.sampleRateHz,
    bitrateKbps: asset.bitrateKbps,
    codec: asset.codec,
    channels: asset.channels,
    fileSizeBytes: asset.fileSizeBytes,
    container: asset.container,
    mediaKind,
    streamUrl: `/api/assets/${asset.id}/stream`,
    downloadUrl: `/api/assets/${asset.id}/download`,
    createdAt: asset.createdAt.toISOString(),
    notes: []
  });
});
