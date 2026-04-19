import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { env } from '../config.js';

const S3_PREFIX = 's3:';

let s3Client: S3Client | null = null;

function getS3Client() {
  if (!env.s3Enabled) {
    throw new Error('S3 is not configured. Set S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY.');
  }

  if (!s3Client) {
    s3Client = new S3Client({
      region: env.s3Region,
      endpoint: env.s3Endpoint,
      forcePathStyle: env.s3ForcePathStyle,
      credentials: {
        accessKeyId: env.s3AccessKeyId,
        secretAccessKey: env.s3SecretAccessKey
      }
    });
  }

  return s3Client;
}

function sanitizeName(value: string) {
  return value.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 120) || 'upload';
}

export function isS3StorageKey(storageKey: string) {
  return storageKey.startsWith(S3_PREFIX);
}

export function toS3StorageKey(s3Key: string) {
  return `${S3_PREFIX}${s3Key}`;
}

export function fromS3StorageKey(storageKey: string) {
  return storageKey.startsWith(S3_PREFIX) ? storageKey.slice(S3_PREFIX.length) : storageKey;
}

export function legacyS3KeyCandidates(storageKey: string) {
  const normalized = fromS3StorageKey(storageKey);
  const candidates = new Set<string>();

  // Current canonical key.
  candidates.add(normalized);

  // Legacy compatibility:
  // - Some records can contain a plain filename that may have been uploaded under uploads/.
  if (normalized.startsWith('uploads/')) {
    const trimmed = normalized.slice('uploads/'.length);
    if (trimmed) {
      candidates.add(trimmed);
    }
  } else {
    candidates.add(`uploads/${normalized}`);
  }

  // Legacy compatibility:
  // - URL-form keys may be stored directly in DB.
  try {
    const parsedUrl = new URL(normalized);
    const host = parsedUrl.hostname;
    const pathParts = parsedUrl.pathname.split('/').filter(Boolean);

    // Path-style: s3.<region>.amazonaws.com/<bucket>/<key>
    // Virtual-hosted style: <bucket>.s3.<region>.amazonaws.com/<key>
    if (host.includes('amazonaws.com') && pathParts.length > 0) {
      if (host.startsWith(`${env.s3Bucket}.`)) {
        const maybeKey = pathParts.join('/');
        if (maybeKey) candidates.add(maybeKey);
      } else if (pathParts[0] === env.s3Bucket && pathParts.length > 1) {
        const maybeKey = pathParts.slice(1).join('/');
        if (maybeKey) candidates.add(maybeKey);
      }
    }
  } catch {
    // Not a URL; continue.
  }

  // Legacy compatibility:
  // - Some keys can include leading bucket segment.
  if (normalized.startsWith(`${env.s3Bucket}/`)) {
    candidates.add(normalized.slice(env.s3Bucket.length + 1));
  }

  return [...candidates];
}

export function buildS3ObjectKey(input: { userId: string; songId: string; fileName: string }) {
  const safeName = sanitizeName(input.fileName);
  const nonce = randomBytes(8).toString('hex');
  return `users/${input.userId}/songs/${input.songId}/${Date.now()}-${nonce}-${safeName}`;
}

export async function uploadFileToS3(params: {
  localFilePath: string;
  objectKey: string;
  contentType?: string;
}) {
  const client = getS3Client();

  await client.send(
    new PutObjectCommand({
      Bucket: env.s3Bucket,
      Key: params.objectKey,
      Body: createReadStream(params.localFilePath),
      ContentType: params.contentType || 'application/octet-stream'
    })
  );

  return toS3StorageKey(params.objectKey);
}

export async function getS3Object(storageKey: string) {
  const client = getS3Client();
  const key = fromS3StorageKey(storageKey);

  const object = await client.send(
    new GetObjectCommand({
      Bucket: env.s3Bucket,
      Key: key
    })
  );

  return object;
}

export async function getS3ObjectWithLegacyFallback(storageKey: string) {
  const client = getS3Client();
  const candidates = legacyS3KeyCandidates(storageKey);

  for (const key of candidates) {
    try {
      const object = await client.send(
        new GetObjectCommand({
          Bucket: env.s3Bucket,
          Key: key
        })
      );

      return { object, resolvedStorageKey: toS3StorageKey(key) };
    } catch {
      // Try next candidate.
    }
  }

  throw new Error('S3 object not found for any key candidate');
}

// Returns a short-lived presigned GET URL, avoiding streaming image bytes through
// the serverless function (which hits Vercel's 4.5 MB response payload limit).
export async function getPresignedUrlWithLegacyFallback(storageKey: string, expiresIn = 3600) {
  const client = getS3Client();
  const candidates = legacyS3KeyCandidates(storageKey);

  for (const key of candidates) {
    try {
      await client.send(new HeadObjectCommand({ Bucket: env.s3Bucket, Key: key }));
      const command = new GetObjectCommand({ Bucket: env.s3Bucket, Key: key });
      const url = await getSignedUrl(client, command, { expiresIn });
      return { url, resolvedStorageKey: toS3StorageKey(key) };
    } catch {
      // Try next candidate.
    }
  }

  throw new Error('S3 object not found for any key candidate');
}

export async function getS3ObjectWithRange(storageKey: string, range?: string) {
  const client = getS3Client();
  const key = fromS3StorageKey(storageKey);

  return client.send(
    new GetObjectCommand({
      Bucket: env.s3Bucket,
      Key: key,
      Range: range
    })
  );
}

export async function getS3ObjectWithRangeLegacyFallback(storageKey: string, range?: string) {
  const client = getS3Client();
  const candidates = legacyS3KeyCandidates(storageKey);

  for (const key of candidates) {
    try {
      const object = await client.send(
        new GetObjectCommand({
          Bucket: env.s3Bucket,
          Key: key,
          Range: range
        })
      );

      return { object, resolvedStorageKey: toS3StorageKey(key) };
    } catch {
      // Try next candidate.
    }
  }

  throw new Error('S3 object not found for any key candidate');
}

export async function headS3Object(storageKey: string) {
  const client = getS3Client();
  const key = fromS3StorageKey(storageKey);

  return client.send(
    new HeadObjectCommand({
      Bucket: env.s3Bucket,
      Key: key
    })
  );
}

export async function deleteS3Object(storageKey: string) {
  const client = getS3Client();
  const key = fromS3StorageKey(storageKey);

  await client.send(
    new DeleteObjectCommand({
      Bucket: env.s3Bucket,
      Key: key
    })
  );
}

export async function runS3HealthCheck() {
  if (!env.s3Enabled) {
    return {
      ok: false,
      message: 'S3 is not enabled in environment config'
    };
  }

  const client = getS3Client();

  await client.send(
    new HeadBucketCommand({
      Bucket: env.s3Bucket
    })
  );

  const probeKey = `health-check/${Date.now()}-${randomBytes(6).toString('hex')}.txt`;
  const probeBody = `studioflow-s3-check:${new Date().toISOString()}:${basename(probeKey)}`;

  await client.send(
    new PutObjectCommand({
      Bucket: env.s3Bucket,
      Key: probeKey,
      Body: probeBody,
      ContentType: 'text/plain'
    })
  );

  await client.send(
    new DeleteObjectCommand({
      Bucket: env.s3Bucket,
      Key: probeKey
    })
  );

  return {
    ok: true,
    message: 'S3 bucket is reachable and write/delete permissions are valid',
    bucket: env.s3Bucket,
    region: env.s3Region,
    endpoint: env.s3Endpoint
  };
}
