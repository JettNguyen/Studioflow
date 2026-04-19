import { createReadStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';

// On Vercel (and other serverless runtimes) process.cwd() is read-only.
// Fall back to the OS temp directory so multer can write temporary files.
import { tmpdir } from 'node:os';
const uploadsDir = process.env.VERCEL ? resolve(tmpdir(), 'studioflow-uploads') : resolve(process.cwd(), 'uploads');

async function ensureUploadDir() {
  await mkdir(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: async (_req, _file, callback) => {
    try {
      await ensureUploadDir();
      callback(null, uploadsDir);
    } catch (error) {
      callback(error as Error, uploadsDir);
    }
  },
  filename: (_req, file, callback) => {
    const safeBase = file.originalname.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_.-]/g, '');
    const extension = extname(safeBase) || '';
    const base = extension ? safeBase.slice(0, -extension.length) : safeBase;
    const unique = crypto.randomBytes(8).toString('hex');
    callback(null, `${Date.now()}-${unique}-${base || 'upload'}${extension}`);
  }
});

export const upload = multer({
  storage,
  limits: {
    fileSize: 300 * 1024 * 1024
  }
});

export const uploadImage = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

export function resolveStoredFilePath(storageKey: string) {
  return resolve(uploadsDir, storageKey);
}

export function openStoredFile(storageKey: string) {
  return createReadStream(resolveStoredFilePath(storageKey));
}
