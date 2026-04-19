import { Router } from 'express';
import { createReadStream, existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { z } from 'zod';
import type { Request, Response } from 'express';
import type { LoginRequest, SignupRequest } from '@studioflow/shared';
import { passport } from '../auth/passport.js';
import { env } from '../config.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { resolveStoredFilePath, uploadImage } from '../storage/localStorage.js';
import {
  buildS3ObjectKey,
  deleteS3Object,
  getS3ObjectWithLegacyFallback,
  isS3StorageKey,
  uploadFileToS3
} from '../storage/s3Storage.js';
import {
  deleteDriveFile,
  getDriveFileStream,
  getGrantedScopes,
  ensureStudioflowRootFolder,
  uploadDriveFile
} from '../utils/drive.js';
import { mapAuthUser } from '../utils/mappers.js';

export const authRouter = Router();

function isDriveStorageKey(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith('drive:');
}

function parseDriveFileId(storageKey: string | null | undefined): string | null {
  if (!isDriveStorageKey(storageKey)) return null;
  const id = storageKey.slice('drive:'.length).trim();
  return id || null;
}

function establishSession(req: Request, res: Response, userId: string, onSuccess: () => void) {
  req.session.userId = userId;

  req.session.save((error) => {
    if (error) {
      return res.status(500).json({ message: 'Unable to persist login session' });
    }

    return onSuccess();
  });
}

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(80)
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128)
});

authRouter.get('/me', (req, res) => {
  res.json({ user: req.user ?? null });
});

authRouter.post('/signup', async (req, res) => {
  const parsed = signupSchema.safeParse(req.body satisfies SignupRequest);

  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid signup payload', errors: parsed.error.flatten() });
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: parsed.data.email }
  });

  if (existingUser) {
    return res.status(409).json({ message: 'An account already exists for this email address' });
  }

  const user = await prisma.user.create({
    data: {
      email: parsed.data.email,
      name: parsed.data.name,
      passwordHash: await hashPassword(parsed.data.password)
    },
    include: {
      oauthAccounts: {
        where: { provider: 'google' }
      }
    }
  });

  return establishSession(req, res, user.id, () => {
    res.status(201).json({ user: mapAuthUser(user) });
  });
});

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body satisfies LoginRequest);

  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid login payload', errors: parsed.error.flatten() });
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    include: {
      oauthAccounts: {
        where: { provider: 'google' }
      }
    }
  });

  if (!user?.passwordHash) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  const passwordMatches = await verifyPassword(parsed.data.password, user.passwordHash);

  if (!passwordMatches) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  return establishSession(req, res, user.id, () => {
    res.json({ user: mapAuthUser(user) });
  });
});

authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.status(204).send();
  });
});

authRouter.get('/google', (req, res, next) => {
  if (!env.googleEnabled) {
    return res.status(503).json({ message: 'Google OAuth is not configured yet' });
  }

  const authOptions: Record<string, unknown> = {
    accessType: 'offline',
    session: false
  };

  // Only force the consent screen when explicitly requested (e.g. reauth flow).
  // `prompt: 'consent'` makes Google show the consent screen every time,
  // so we avoid it by default to prevent repeated prompts.
  const reauth = String(req.query.reauth ?? '').toLowerCase();
  if (reauth === '1' || reauth === 'true') {
    // Useful when you need to obtain a fresh refresh token or re-consent.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore passport accepts this option in authenticate()
    authOptions.prompt = 'consent';
  }

  const authenticator = passport.authenticate('google', authOptions);

  authenticator(req, res, next);
});

authRouter.get('/google/callback', (req, res, next) => {
  if (!env.googleEnabled) {
    return res.redirect(`${env.clientOrigin}/login?error=google-not-configured`);
  }

  passport.authenticate('google', { session: false }, (error: Error | null, user) => {
    if (error || !user) {
      return res.redirect(`${env.clientOrigin}/login?error=google-auth-failed`);
    }

    return establishSession(req, res, user.id, () => {
      res.redirect(`${env.clientOrigin}/`);
    });
  })(req, res, next);
});

authRouter.get('/me/avatar', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user?.avatarStorageKey) return res.status(404).json({ message: 'No avatar' });

  const driveFileId = parseDriveFileId(user.avatarStorageKey);
  if (driveFileId) {
    const googleAccount = await prisma.oAuthAccount.findFirst({
      where: { userId: req.user!.id, provider: 'google', refreshToken: { not: null } }
    });
    if (!googleAccount) {
      return res.status(404).json({ message: 'Avatar source account not connected' });
    }

    try {
      const driveObject = await getDriveFileStream(googleAccount, driveFileId);
      res.setHeader('Content-Type', driveObject.mimeType || 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      driveObject.stream.pipe(res);
      return;
    } catch (err) {
      console.error('[Drive avatar error]', user.avatarStorageKey, err);
      return res.status(404).json({ message: 'Avatar not found' });
    }
  }

  // Prefer S3 when enabled, regardless of whether the DB key is prefixed.
  // This keeps avatar rendering consistent across devices/sessions where local
  // files may no longer exist.
  if (env.s3Enabled) {
    try {
      const { object, resolvedStorageKey } = await getS3ObjectWithLegacyFallback(user.avatarStorageKey);

      // Self-heal legacy/plain keys so future requests avoid fallback probes.
      if (resolvedStorageKey !== user.avatarStorageKey) {
        void prisma.user.update({
          where: { id: user.id },
          data: { avatarStorageKey: resolvedStorageKey }
        }).catch(() => undefined);
      }

      res.setHeader('Content-Type', object.ContentType || 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      (object.Body as NodeJS.ReadableStream).pipe(res);
      return;
    } catch (err) {
      console.error('[S3 avatar error]', user.avatarStorageKey, err);
      // Fall through to local lookup for legacy local-only avatars.
    }
  }

  const fullPath = resolveStoredFilePath(user.avatarStorageKey);
  if (!existsSync(fullPath)) return res.status(404).json({ message: 'Avatar not found' });

  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  createReadStream(fullPath).pipe(res);
});

authRouter.post('/me/avatar', requireAuth, uploadImage.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No image file provided' });

  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  const previousStorageKey = user?.avatarStorageKey ?? null;
  const localFilePath = resolveStoredFilePath(req.file.filename);
  let storageKey = req.file.filename;

  const googleAccount = !env.s3Enabled
    ? await prisma.oAuthAccount.findFirst({
      where: { userId: req.user!.id, provider: 'google', refreshToken: { not: null } }
    })
    : null;

  if (!env.s3Enabled && env.nodeEnv === 'production' && !googleAccount) {
    await unlink(localFilePath).catch(() => undefined);
    return res.status(503).json({
      message: 'Avatar persistence requires either object storage or a connected Google Drive account.'
    });
  }

  try {
    if (env.s3Enabled) {
      const s3Key = buildS3ObjectKey({ userId: req.user!.id, songId: 'avatar', fileName: req.file.originalname });
      storageKey = await uploadFileToS3({ localFilePath, objectKey: s3Key, contentType: req.file.mimetype });
      await unlink(localFilePath).catch(() => undefined);
    } else if (googleAccount) {
      let rootFolderId: string | null = null;
      try {
        rootFolderId = await ensureStudioflowRootFolder(googleAccount);
      } catch {
        rootFolderId = null;
      }

      const uploadedDriveFileId = await uploadDriveFile(googleAccount, {
        localFilePath,
        name: `avatar-${req.user!.id}-${Date.now()}-${req.file.originalname}`,
        mimeType: req.file.mimetype,
        parentFolderId: rootFolderId
      });

      if (!uploadedDriveFileId) {
        throw new Error('Drive avatar upload failed');
      }

      storageKey = `drive:${uploadedDriveFileId}`;
      await unlink(localFilePath).catch(() => undefined);
    }
  } catch {
    await unlink(localFilePath).catch(() => undefined);
    return res.status(500).json({ message: 'Failed to store avatar' });
  }

  let updated;
  try {
    updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: { avatarStorageKey: storageKey },
      include: { oauthAccounts: { where: { provider: 'google' } } }
    });
  } catch {
    try {
      const uploadedDriveFileId = parseDriveFileId(storageKey);
      if (uploadedDriveFileId) {
        const googleAccount = await prisma.oAuthAccount.findFirst({
          where: { userId: req.user!.id, provider: 'google', refreshToken: { not: null } }
        });
        if (googleAccount) {
          await deleteDriveFile(googleAccount, uploadedDriveFileId);
        }
      } else if (isS3StorageKey(storageKey)) {
        await deleteS3Object(storageKey);
      } else {
        const uploadedPath = resolveStoredFilePath(storageKey);
        if (existsSync(uploadedPath)) await unlink(uploadedPath).catch(() => undefined);
      }
    } catch {
      // best effort cleanup only
    }

    return res.status(500).json({ message: 'Failed to persist avatar metadata' });
  }

  if (previousStorageKey && previousStorageKey !== storageKey) {
    try {
      const previousDriveFileId = parseDriveFileId(previousStorageKey);
      if (previousDriveFileId) {
        const prevGoogleAccount = await prisma.oAuthAccount.findFirst({
          where: { userId: req.user!.id, provider: 'google', refreshToken: { not: null } }
        });
        if (prevGoogleAccount) {
          await deleteDriveFile(prevGoogleAccount, previousDriveFileId);
        }
      } else if (isS3StorageKey(previousStorageKey)) {
        await deleteS3Object(previousStorageKey);
      } else {
        const prev = resolveStoredFilePath(previousStorageKey);
        if (existsSync(prev)) await unlink(prev).catch(() => undefined);
      }
    } catch { /* non-fatal */ }
  }

  res.json({ user: mapAuthUser(updated) });
});

authRouter.delete('/me/avatar', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    include: { oauthAccounts: { where: { provider: 'google' } } }
  });
  if (!user?.avatarStorageKey) return res.json({ user: mapAuthUser(user!) });

  try {
    const driveFileId = parseDriveFileId(user.avatarStorageKey);
    if (driveFileId) {
      const googleAccount = await prisma.oAuthAccount.findFirst({
        where: { userId: req.user!.id, provider: 'google', refreshToken: { not: null } }
      });
      if (googleAccount) {
        await deleteDriveFile(googleAccount, driveFileId);
      }
    } else if (isS3StorageKey(user.avatarStorageKey)) {
      await deleteS3Object(user.avatarStorageKey);
    } else {
      const fullPath = resolveStoredFilePath(user.avatarStorageKey);
      if (existsSync(fullPath)) await unlink(fullPath).catch(() => undefined);
    }
  } catch { /* non-fatal */ }

  const updated = await prisma.user.update({
    where: { id: req.user!.id },
    data: { avatarStorageKey: null },
    include: { oauthAccounts: { where: { provider: 'google' } } }
  });

  res.json({ user: mapAuthUser(updated) });
});

authRouter.get('/drive-status', requireAuth, async (req, res) => {
  const account = await prisma.oAuthAccount.findFirst({
    where: {
      userId: req.user!.id,
      provider: 'google'
    }
  });

  res.json({
    connected: Boolean(account),
    email: account?.email ?? null,
    scopes: getGrantedScopes(account)
  });
});
