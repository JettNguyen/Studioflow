import type { OAuthAccount } from '@prisma/client';
import { createReadStream } from 'node:fs';
import { google } from 'googleapis';
import { env } from '../config.js';

function getOAuthClient() {
  return new google.auth.OAuth2(env.googleClientId, env.googleClientSecret, env.googleRedirectUri);
}

function getAuthorizedClient(account: OAuthAccount) {
  if (!account.refreshToken) {
    throw new Error('Google Drive account is not linked with offline access.');
  }

  const oauthClient = getOAuthClient();
  oauthClient.setCredentials({
    refresh_token: account.refreshToken,
    access_token: account.accessToken ?? undefined,
    expiry_date: account.expiresAt ? account.expiresAt.getTime() : undefined
  });

  return oauthClient;
}

export function getGrantedScopes(account: OAuthAccount | null) {
  return account?.scope?.split(' ').filter(Boolean) ?? [];
}

function escapeDriveQueryValue(value: string) {
  return value.replace(/'/g, "\\'");
}

async function findDriveFolderId(
  account: OAuthAccount,
  folderName: string,
  parentFolderId?: string | null
) {
  const oauthClient = getAuthorizedClient(account);
  const drive = google.drive({ version: 'v3', auth: oauthClient });

  const queryParts = [
    `mimeType='application/vnd.google-apps.folder'`,
    `trashed=false`,
    `name='${escapeDriveQueryValue(folderName)}'`
  ];

  if (parentFolderId) {
    queryParts.push(`'${escapeDriveQueryValue(parentFolderId)}' in parents`);
  }

  const response = await drive.files.list({
    q: queryParts.join(' and '),
    pageSize: 1,
    orderBy: 'createdTime asc',
    fields: 'files(id,name)'
  });

  return response.data.files?.[0]?.id ?? null;
}

async function findOrCreateDriveFolder(
  account: OAuthAccount,
  folderName: string,
  parentFolderId?: string | null
) {
  const existingId = await findDriveFolderId(account, folderName, parentFolderId);

  if (existingId) {
    return existingId;
  }

  return createDriveFolder(account, folderName, parentFolderId);
}

export async function ensureStudioflowRootFolder(account: OAuthAccount) {
  return findOrCreateDriveFolder(account, 'Studioflow');
}

export async function ensureStudioflowProjectFolder(account: OAuthAccount, projectTitle: string) {
  const studioflowRootFolderId = await ensureStudioflowRootFolder(account);

  if (!studioflowRootFolderId) {
    return null;
  }

  return findOrCreateDriveFolder(account, projectTitle, studioflowRootFolderId);
}

/**
 * Maps a song asset category label to a human-readable Drive folder name.
 * Categories without a dedicated folder (e.g. 'Other') return null — files
 * go directly in the song folder.
 */
function categoryToDriveFolderName(category: string): string | null {
  switch (category) {
    case 'Song Audio': return 'Song Audio';
    case 'Stems':      return 'Stems';
    case 'Beat':       return 'Beat';
    case 'Videos':     return 'Videos';
    case 'Social Media Content': return 'Social Media Content';
    default:           return null;
  }
}

/**
 * Returns the Drive folder ID for the given asset category inside a song's
 * Drive folder, creating the subfolder if it doesn't exist yet.
 * Returns the song's root Drive folder ID when no dedicated subfolder is
 * needed (e.g. 'Shot List', 'Other').
 */
export async function ensureSongCategoryFolder(
  account: OAuthAccount,
  category: string,
  songDriveFolderId: string
): Promise<string> {
  const folderName = categoryToDriveFolderName(category);
  if (!folderName) return songDriveFolderId;
  const subFolderId = await findOrCreateDriveFolder(account, folderName, songDriveFolderId);
  return subFolderId ?? songDriveFolderId;
}

export async function createDriveFolder(account: OAuthAccount, folderName: string, parentFolderId?: string | null) {
  const oauthClient = getAuthorizedClient(account);

  const drive = google.drive({ version: 'v3', auth: oauthClient });
  const response = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentFolderId ? [parentFolderId] : undefined
    },
    fields: 'id'
  });

  return response.data.id ?? null;
}

export async function uploadDriveFile(
  account: OAuthAccount,
  input: {
    localFilePath: string;
    name: string;
    mimeType?: string;
    parentFolderId?: string | null;
  }
) {
  const oauthClient = getAuthorizedClient(account);
  const drive = google.drive({ version: 'v3', auth: oauthClient });

  const response = await drive.files.create({
    requestBody: {
      name: input.name,
      parents: input.parentFolderId ? [input.parentFolderId] : undefined
    },
    media: {
      mimeType: input.mimeType || 'application/octet-stream',
      body: createReadStream(input.localFilePath)
    },
    fields: 'id'
  });

  return response.data.id ?? null;
}

export async function deleteDriveFile(account: OAuthAccount, driveFileId: string) {
  const oauthClient = getAuthorizedClient(account);
  const drive = google.drive({ version: 'v3', auth: oauthClient });

  await drive.files.delete({
    fileId: driveFileId
  });
}

export async function getDriveFileStream(account: OAuthAccount, driveFileId: string, range?: string) {
  const oauthClient = getAuthorizedClient(account);
  const drive = google.drive({ version: 'v3', auth: oauthClient });

  const [metaRes, mediaRes] = await Promise.all([
    drive.files.get({
      fileId: driveFileId,
      fields: 'name,mimeType,size'
    }),
    drive.files.get(
      {
        fileId: driveFileId,
        alt: 'media'
      },
      {
        responseType: 'stream',
        headers: range ? { Range: range } : undefined
      }
    )
  ]);

  return {
    stream: mediaRes.data as NodeJS.ReadableStream,
    mimeType: metaRes.data.mimeType || undefined,
    size: typeof metaRes.data.size === 'string' ? Number.parseInt(metaRes.data.size, 10) : undefined,
    name: metaRes.data.name || undefined
  };
}
