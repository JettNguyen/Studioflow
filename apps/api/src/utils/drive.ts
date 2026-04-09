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
