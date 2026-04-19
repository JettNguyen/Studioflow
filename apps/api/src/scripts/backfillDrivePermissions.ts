/**
 * backfillDrivePermissions
 *
 * Grants "anyone with the link / reader" access to every Drive file that was
 * uploaded before the permission was set automatically on upload.
 *
 * Covers all four storage locations:
 *   - User.avatarStorageKey  (drive:<fileId>)
 *   - Project.coverImageKey  (drive:<fileId>)
 *   - Asset.driveFileId      (raw fileId)
 *   - ProjectAsset.driveFileId (raw fileId)
 *
 * Usage:
 *   npm run drive:backfill-permissions            # live run
 *   npm run drive:backfill-permissions -- --dry-run   # preview only, no API calls
 *
 * The script is idempotent — re-running it on already-shared files is safe.
 */

import { prisma } from '../lib/prisma.js';
import { env } from '../config.js';
import { setDriveFilePublicRead } from '../utils/drive.js';
import type { OAuthAccount } from '@prisma/client';

const DRY_RUN = process.argv.includes('--dry-run');

// Milliseconds to wait between Drive API calls to stay well under quota.
const RATE_LIMIT_MS = 120;

type Counters = {
  scanned: number;
  granted: number;
  alreadyOk: number;
  noAccount: number;
  failed: number;
  skipped: number; // dry-run
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printSummary(label: string, c: Counters) {
  console.log(`\n[${label}]`);
  console.log(`  scanned:    ${c.scanned}`);
  if (DRY_RUN) {
    console.log(`  would set:  ${c.skipped}`);
    console.log(`  no account: ${c.noAccount}`);
  } else {
    console.log(`  granted:    ${c.granted}`);
    console.log(`  already ok: ${c.alreadyOk}`);
    console.log(`  no account: ${c.noAccount}`);
    console.log(`  failed:     ${c.failed}`);
  }
}

/**
 * Attempt to set public-read on a single Drive file ID using the first
 * account that succeeds. Returns 'granted' | 'already_ok' | 'failed'.
 */
async function grantPermission(
  fileId: string,
  accounts: OAuthAccount[],
  label: string
): Promise<'granted' | 'already_ok' | 'failed' | 'dry_run'> {
  if (DRY_RUN) {
    console.log(`  [dry-run] would set anyone/reader on ${fileId} (${label})`);
    return 'dry_run';
  }

  for (const account of accounts) {
    try {
      const result = await setDriveFilePublicRead(account, fileId);
      return result; // 'granted' or 'already_ok'
    } catch (err: unknown) {
      // setDriveFilePublicRead throws for non-400 errors — try the next account.
      console.warn(`  [warn] permission failed for ${fileId} via account ${account.userId}:`,
        (err as Error)?.message ?? err);
    }
  }

  return 'failed';
}

// ── Avatars ────────────────────────────────────────────────────────────────────

async function backfillAvatars(): Promise<Counters> {
  const counters: Counters = { scanned: 0, granted: 0, alreadyOk: 0, noAccount: 0, failed: 0, skipped: 0 };

  const users = await prisma.user.findMany({
    where: { avatarStorageKey: { startsWith: 'drive:' } },
    select: {
      id: true,
      avatarStorageKey: true,
      oauthAccounts: {
        where: { provider: 'google', refreshToken: { not: null } }
      }
    }
  });

  for (const user of users) {
    const key = user.avatarStorageKey;
    if (!key?.startsWith('drive:')) continue;
    const fileId = key.slice('drive:'.length).trim();
    if (!fileId) continue;

    counters.scanned++;

    if (!user.oauthAccounts.length) {
      console.log(`  [skip] no Drive account for user ${user.id} (avatar ${fileId})`);
      counters.noAccount++;
      continue;
    }

    const result = await grantPermission(fileId, user.oauthAccounts, `avatar:${user.id}`);
    if (result === 'granted') counters.granted++;
    else if (result === 'already_ok') counters.alreadyOk++;
    else if (result === 'failed') { counters.failed++; console.error(`  [error] avatar ${fileId} for user ${user.id}`); }
    else counters.skipped++;

    await sleep(RATE_LIMIT_MS);
  }

  return counters;
}

// ── Cover images ───────────────────────────────────────────────────────────────

async function backfillCovers(): Promise<Counters> {
  const counters: Counters = { scanned: 0, granted: 0, alreadyOk: 0, noAccount: 0, failed: 0, skipped: 0 };

  const projects = await prisma.project.findMany({
    where: { coverImageKey: { startsWith: 'drive:' } },
    select: {
      id: true,
      coverImageKey: true,
      memberships: {
        select: {
          user: {
            select: {
              oauthAccounts: {
                where: { provider: 'google', refreshToken: { not: null } }
              }
            }
          }
        }
      }
    }
  });

  for (const project of projects) {
    const key = project.coverImageKey;
    if (!key?.startsWith('drive:')) continue;
    const fileId = key.slice('drive:'.length).trim();
    if (!fileId) continue;

    counters.scanned++;

    // Collect all member accounts that have Drive connected.
    const accounts = project.memberships
      .flatMap((m) => m.user.oauthAccounts)
      .filter((a): a is OAuthAccount => Boolean(a.refreshToken));

    if (!accounts.length) {
      console.log(`  [skip] no Drive account for project ${project.id} (cover ${fileId})`);
      counters.noAccount++;
      continue;
    }

    const result = await grantPermission(fileId, accounts, `cover:${project.id}`);
    if (result === 'granted') counters.granted++;
    else if (result === 'already_ok') counters.alreadyOk++;
    else if (result === 'failed') { counters.failed++; console.error(`  [error] cover ${fileId} for project ${project.id}`); }
    else counters.skipped++;

    await sleep(RATE_LIMIT_MS);
  }

  return counters;
}

// ── Song assets ────────────────────────────────────────────────────────────────

async function backfillSongAssets(): Promise<Counters> {
  const counters: Counters = { scanned: 0, granted: 0, alreadyOk: 0, noAccount: 0, failed: 0, skipped: 0 };

  const assets = await prisma.asset.findMany({
    where: { driveFileId: { not: null } },
    select: {
      id: true,
      driveFileId: true,
      song: {
        select: {
          project: {
            select: {
              id: true,
              memberships: {
                select: {
                  user: {
                    select: {
                      oauthAccounts: {
                        where: { provider: 'google', refreshToken: { not: null } }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  });

  for (const asset of assets) {
    const fileId = asset.driveFileId;
    if (!fileId) continue;

    counters.scanned++;

    const accounts = asset.song.project.memberships
      .flatMap((m) => m.user.oauthAccounts)
      .filter((a): a is OAuthAccount => Boolean(a.refreshToken));

    if (!accounts.length) {
      console.log(`  [skip] no Drive account for asset ${asset.id} (file ${fileId})`);
      counters.noAccount++;
      continue;
    }

    const result = await grantPermission(fileId, accounts, `asset:${asset.id}`);
    if (result === 'granted') counters.granted++;
    else if (result === 'already_ok') counters.alreadyOk++;
    else if (result === 'failed') { counters.failed++; console.error(`  [error] song asset ${fileId} (asset ${asset.id})`); }
    else counters.skipped++;

    await sleep(RATE_LIMIT_MS);
  }

  return counters;
}

// ── Project assets ─────────────────────────────────────────────────────────────

async function backfillProjectAssets(): Promise<Counters> {
  const counters: Counters = { scanned: 0, granted: 0, alreadyOk: 0, noAccount: 0, failed: 0, skipped: 0 };

  // ProjectAsset uses raw SQL (driveFileId column may not be in Prisma client yet).
  const rows = await prisma.$queryRaw<Array<{ id: string; driveFileId: string | null; projectId: string }>>`
    SELECT id, "driveFileId", "projectId"
    FROM "ProjectAsset"
    WHERE "driveFileId" IS NOT NULL
  `;

  if (!rows.length) return counters;

  // Load all relevant project memberships in bulk to avoid N+1 queries.
  const projectIds = Array.from(new Set(rows.map((r) => r.projectId)));
  const memberships = await prisma.projectMembership.findMany({
    where: { projectId: { in: projectIds } },
    select: {
      projectId: true,
      user: {
        select: {
          oauthAccounts: {
            where: { provider: 'google', refreshToken: { not: null } }
          }
        }
      }
    }
  });

  // Build projectId → OAuthAccount[] map.
  const accountsByProject = new Map<string, OAuthAccount[]>();
  for (const m of memberships) {
    const existing = accountsByProject.get(m.projectId) ?? [];
    existing.push(...(m.user.oauthAccounts as OAuthAccount[]));
    accountsByProject.set(m.projectId, existing);
  }

  for (const row of rows) {
    const fileId = row.driveFileId;
    if (!fileId) continue;

    counters.scanned++;

    const accounts = (accountsByProject.get(row.projectId) ?? [])
      .filter((a) => Boolean(a.refreshToken));

    if (!accounts.length) {
      console.log(`  [skip] no Drive account for project-asset ${row.id} (file ${fileId})`);
      counters.noAccount++;
      continue;
    }

    const result = await grantPermission(fileId, accounts, `project-asset:${row.id}`);
    if (result === 'granted') counters.granted++;
    else if (result === 'already_ok') counters.alreadyOk++;
    else if (result === 'failed') { counters.failed++; console.error(`  [error] project asset ${fileId} (row ${row.id})`); }
    else counters.skipped++;

    await sleep(RATE_LIMIT_MS);
  }

  return counters;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  if (!env.googleEnabled) {
    console.error('Google OAuth is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI missing).');
    process.exit(1);
  }

  console.log(`Backfilling Drive file permissions${DRY_RUN ? ' [DRY RUN — no changes will be made]' : ''}...`);
  console.log('');

  console.log('Processing avatars...');
  const avatars = await backfillAvatars();

  console.log('Processing cover images...');
  const covers = await backfillCovers();

  console.log('Processing song assets...');
  const songAssets = await backfillSongAssets();

  console.log('Processing project assets...');
  const projectAssets = await backfillProjectAssets();

  printSummary('avatars', avatars);
  printSummary('covers', covers);
  printSummary('song-assets', songAssets);
  printSummary('project-assets', projectAssets);

  const totalGranted = avatars.granted + covers.granted + songAssets.granted + projectAssets.granted;
  const totalAlreadyOk = avatars.alreadyOk + covers.alreadyOk + songAssets.alreadyOk + projectAssets.alreadyOk;
  const totalNoAccount = avatars.noAccount + covers.noAccount + songAssets.noAccount + projectAssets.noAccount;
  const totalFailed = avatars.failed + covers.failed + songAssets.failed + projectAssets.failed;
  const totalScanned = avatars.scanned + covers.scanned + songAssets.scanned + projectAssets.scanned;

  console.log('\n──────────────────────────');
  console.log(`total scanned:    ${totalScanned}`);
  if (DRY_RUN) {
    console.log(`would set:        ${avatars.skipped + covers.skipped + songAssets.skipped + projectAssets.skipped}`);
  } else {
    console.log(`granted:          ${totalGranted}`);
    console.log(`already ok:       ${totalAlreadyOk}`);
    console.log(`no account:       ${totalNoAccount}`);
    console.log(`failed:           ${totalFailed}`);
  }

  if (totalFailed > 0) {
    console.log('\nSome files could not be updated. Re-run after verifying the Drive accounts above are still connected.');
    process.exit(1);
  }

  console.log('\nDone.');
}

void main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
