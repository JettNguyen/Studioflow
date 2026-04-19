import { basename } from 'node:path';
import { existsSync } from 'node:fs';
import { env } from '../config.js';
import { prisma } from '../lib/prisma.js';
import { resolveStoredFilePath } from '../storage/localStorage.js';
import { buildS3ObjectKey, uploadFileToS3 } from '../storage/s3Storage.js';

type Counters = {
  scanned: number;
  migrated: number;
  missing: number;
  failed: number;
};

function printSummary(label: string, counters: Counters) {
  console.log(`\n[${label}]`);
  console.log(`scanned:  ${counters.scanned}`);
  console.log(`migrated: ${counters.migrated}`);
  console.log(`missing:  ${counters.missing}`);
  console.log(`failed:   ${counters.failed}`);
}

async function migrateAssets() {
  const counters: Counters = { scanned: 0, migrated: 0, missing: 0, failed: 0 };

  const assets = await prisma.asset.findMany({
    where: {
      storageKey: {
        not: null
      }
      ,
      NOT: {
        storageKey: {
          startsWith: 's3:'
        }
      }
    },
    include: {
      song: {
        include: {
          project: {
            select: {
              createdById: true
            }
          }
        }
      }
    }
  });

  for (const asset of assets) {
    if (!asset.storageKey) continue;
    counters.scanned += 1;

    const localFilePath = resolveStoredFilePath(asset.storageKey);
    if (!existsSync(localFilePath)) {
      counters.missing += 1;
      continue;
    }

    try {
      const objectKey = buildS3ObjectKey({
        userId: asset.song.project.createdById,
        songId: asset.songId,
        fileName: basename(asset.storageKey)
      });

      const storageKey = await uploadFileToS3({
        localFilePath,
        objectKey,
        contentType: asset.type || 'application/octet-stream'
      });

      await prisma.asset.update({
        where: { id: asset.id },
        data: { storageKey }
      });

      counters.migrated += 1;
    } catch (error) {
      counters.failed += 1;
      console.error('[asset migrate failed]', asset.id, error);
    }
  }

  return counters;
}

async function migrateAvatars() {
  const counters: Counters = { scanned: 0, migrated: 0, missing: 0, failed: 0 };

  const users = await prisma.user.findMany({
    where: {
      avatarStorageKey: {
        not: null
      }
      ,
      NOT: {
        avatarStorageKey: {
          startsWith: 's3:'
        }
      }
    },
    select: {
      id: true,
      avatarStorageKey: true
    }
  });

  for (const user of users) {
    if (!user.avatarStorageKey) continue;
    counters.scanned += 1;

    const localFilePath = resolveStoredFilePath(user.avatarStorageKey);
    if (!existsSync(localFilePath)) {
      counters.missing += 1;
      continue;
    }

    try {
      const objectKey = buildS3ObjectKey({
        userId: user.id,
        songId: 'avatar',
        fileName: basename(user.avatarStorageKey)
      });

      const storageKey = await uploadFileToS3({
        localFilePath,
        objectKey,
        contentType: 'image/jpeg'
      });

      await prisma.user.update({
        where: { id: user.id },
        data: { avatarStorageKey: storageKey }
      });

      counters.migrated += 1;
    } catch (error) {
      counters.failed += 1;
      console.error('[avatar migrate failed]', user.id, error);
    }
  }

  return counters;
}

async function migrateCovers() {
  const counters: Counters = { scanned: 0, migrated: 0, missing: 0, failed: 0 };

  const projects = await prisma.project.findMany({
    where: {
      coverImageKey: {
        not: null
      }
      ,
      NOT: {
        coverImageKey: {
          startsWith: 's3:'
        }
      }
    },
    select: {
      id: true,
      createdById: true,
      coverImageKey: true
    }
  });

  for (const project of projects) {
    if (!project.coverImageKey) continue;
    counters.scanned += 1;

    const localFilePath = resolveStoredFilePath(project.coverImageKey);
    if (!existsSync(localFilePath)) {
      counters.missing += 1;
      continue;
    }

    try {
      const objectKey = buildS3ObjectKey({
        userId: project.createdById,
        songId: project.id,
        fileName: basename(project.coverImageKey)
      });

      const storageKey = await uploadFileToS3({
        localFilePath,
        objectKey,
        contentType: 'image/jpeg'
      });

      await prisma.project.update({
        where: { id: project.id },
        data: { coverImageKey: storageKey }
      });

      counters.migrated += 1;
    } catch (error) {
      counters.failed += 1;
      console.error('[cover migrate failed]', project.id, error);
    }
  }

  return counters;
}

async function migrateProjectAssets() {
  const counters: Counters = { scanned: 0, migrated: 0, missing: 0, failed: 0 };

  const rows = await prisma.$queryRaw<Array<{ id: string; projectId: string; storageKey: string | null }>>`
    SELECT id, "projectId", "storageKey"
    FROM "ProjectAsset"
    WHERE "storageKey" IS NOT NULL
      AND "storageKey" NOT LIKE 's3:%'
      AND "storageKey" NOT LIKE 'link:%'
      AND "storageKey" NOT LIKE 'drive:%'
  `;

  for (const row of rows) {
    if (!row.storageKey) continue;
    counters.scanned++;

    const localFilePath = resolveStoredFilePath(row.storageKey);
    if (!existsSync(localFilePath)) {
      counters.missing++;
      continue;
    }

    try {
      const objectKey = buildS3ObjectKey({
        userId: row.projectId,
        songId: 'project-assets',
        fileName: basename(row.storageKey)
      });

      const storageKey = await uploadFileToS3({
        localFilePath,
        objectKey,
        contentType: 'application/octet-stream'
      });

      await prisma.$executeRaw`
        UPDATE "ProjectAsset"
        SET "storageKey" = ${storageKey}
        WHERE id = ${row.id}
      `;

      counters.migrated++;
    } catch (error) {
      counters.failed++;
      console.error('[project-asset migrate failed]', row.id, error);
    }
  }

  return counters;
}

async function main() {
  if (!env.s3Enabled) {
    console.error('S3 is not enabled. Configure S3_* env vars first.');
    process.exit(1);
  }

  console.log('Migrating legacy local storage keys to S3...');

  const [assets, avatars, covers, projectAssets] = await Promise.all([
    migrateAssets(),
    migrateAvatars(),
    migrateCovers(),
    migrateProjectAssets()
  ]);

  printSummary('assets', assets);
  printSummary('avatars', avatars);
  printSummary('covers', covers);
  printSummary('project-assets', projectAssets);

  const totalMigrated = assets.migrated + avatars.migrated + covers.migrated + projectAssets.migrated;
  const totalMissing = assets.missing + avatars.missing + covers.missing + projectAssets.missing;
  const totalFailed = assets.failed + avatars.failed + covers.failed + projectAssets.failed;

  console.log('\nDone.');
  console.log(`total migrated: ${totalMigrated}`);
  console.log(`total missing:  ${totalMissing}`);
  console.log(`total failed:   ${totalFailed}`);
}

void main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
