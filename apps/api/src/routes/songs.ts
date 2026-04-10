import { Router } from 'express';
import { unlink } from 'node:fs/promises';
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
import { buildS3ObjectKey, uploadFileToS3 } from '../storage/s3Storage.js';
import { createDriveFolder, uploadDriveFile } from '../utils/drive.js';
import { mapSongWorkspace } from '../utils/mappers.js';

export const songRouter = Router();
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

songRouter.use(requireAuth);

songRouter.post('/project/:projectId', async (req, res) => {
  const parsed = createSongSchema.safeParse(req.body satisfies CreateSongRequest);

  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid song payload', errors: parsed.error.flatten() });
  }

  const membership = await prisma.projectMembership.findFirst({
    where: {
      userId: req.user!.id,
      projectId: req.params.projectId
    },
    include: {
      project: true
    }
  });

  if (!membership) {
    return res.status(404).json({ message: 'Project not found' });
  }

  let driveFolderId: string | null = null;

  if (membership.project.driveFolderId) {
    const googleAccount = await prisma.oAuthAccount.findFirst({
      where: { userId: req.user!.id, provider: 'google' }
    });

    if (googleAccount) {
      try {
        driveFolderId = await createDriveFolder(
          googleAccount,
          parsed.data.title,
          membership.project.driveFolderId
        );
      } catch {
        driveFolderId = null;
      }
    }
  }

  // Determine position: append to end by finding current max position
  const maxPos = await prisma.song.findFirst({
    where: { projectId: req.params.projectId },
    orderBy: { position: 'desc' }
  });

  const nextPosition = (maxPos?.position ?? -1) + 1;

  const song = await prisma.song.create({
    data: {
      projectId: req.params.projectId,
      title: parsed.data.title,
      status: parsed.data.status ?? 'Draft',
      position: nextPosition,
      keySignature: parsed.data.key,
      bpm: parsed.data.bpm,
      driveFolderId
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

  res.status(201).json(mapSongWorkspace(song));
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

  res.json(mapSongWorkspace(song));
});

const updateSongSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  lyrics: z.string().max(100000).nullable().optional(),
  key: z.string().max(30).nullable().optional(),
  bpm: z.number().int().positive().max(400).nullable().optional(),
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

  res.json(mapSongWorkspace(song));
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

  const googleAccount = song.driveFolderId
    ? await prisma.oAuthAccount.findFirst({
      where: {
        userId: req.user!.id,
        provider: 'google'
      }
    })
    : null;

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

  try {
    if (env.s3Enabled && req.file.path) {
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
    }

    if (song.driveFolderId && googleAccount) {
      driveFileId = await uploadDriveFile(googleAccount, {
        localFilePath,
        name: `${inputAssetName} (v${nextVersionNumber})`,
        mimeType: req.file.mimetype,
        parentFolderId: song.driveFolderId
      });
    }

    if (env.s3Enabled) {
      await unlink(localFilePath).catch(() => undefined);
    }
  } catch {
    await unlink(localFilePath).catch(() => undefined);
    return res.status(500).json({ message: 'Failed to upload file to storage backend' });
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
      storageKey,
      driveFileId
    }
  });

  if (prismaCategory === 'SongAudio' && (inferredKey || inferredBpm)) {
    await prisma.song.update({
      where: { id: songId },
      data: {
        keySignature: inferredKey ?? song.keySignature,
        bpm: inferredBpm ?? song.bpm
      }
    });
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
