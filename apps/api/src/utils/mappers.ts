import type { OAuthAccount, Project, ProjectMembership, Song, Task, User } from '@prisma/client';
import type {
  AssetCategory,
  AuthUser,
  ProjectAsset,
  ProjectAssetNote,
  ProjectAssetCategory,
  ProjectDetails,
  ProjectSummary,
  ProjectSyncStatus,
  SongNote,
  SongAssetNote,
  SongSummary,
  SongTask,
  SongTaskStatus,
  SongWorkspace
} from '@studioflow/shared';

function mapSyncStatus(status: string): ProjectSyncStatus {
  if (status === 'NotLinked') {
    return 'Not Linked';
  }

  if (status === 'NeedsAttention') {
    return 'Needs Attention';
  }

  return status as ProjectSyncStatus;
}

function mapTaskStatus(status: string): SongTaskStatus {
  if (status === 'InReview') {
    return 'In Review';
  }

  return status as SongTaskStatus;
}

function inferMediaKind(type: string, fileName: string): 'audio' | 'video' | 'other' {
  const loweredType = type.toLowerCase();
  const loweredName = fileName.toLowerCase();

  if (loweredType.startsWith('audio/') || /\.(mp3|wav|aiff|aac|m4a|ogg|flac)$/i.test(loweredName)) {
    return 'audio';
  }

  if (loweredType.startsWith('video/') || /\.(mp4|mov|webm|mkv|avi)$/i.test(loweredName)) {
    return 'video';
  }

  return 'other';
}

function mapAssetCategory(category: string): AssetCategory {
  if (category === 'SongAudio') {
    return 'Song Audio';
  }

  if (category === 'SocialMediaContent') {
    return 'Social Media Content';
  }

  if (category === 'Videos') {
    return 'Videos';
  }

  if (category === 'Beat') {
    return 'Beat';
  }

  return 'Stems';
}

export function mapProjectAssetCategory(category: string): ProjectAssetCategory {
  // Category is now stored as a plain string (display name) — return as-is.
  return (category || 'Other') as ProjectAssetCategory;
}

export function mapProjectAsset(
  asset: {
    id: string;
    projectId: string;
    name: string;
    type: string;
    category: string;
    versionGroup: string;
    versionNumber: number;
    fileSizeBytes: number | null;
    storageKey: string | null;
    createdAt: Date;
    notes?: Array<{ id: string; body: string; createdAt: Date; author: { name: string } }>;
  }
): ProjectAsset {
  const isLink = Boolean(asset.storageKey?.startsWith('link:'));
  const downloadUrl = isLink
    ? asset.storageKey!.slice(5)
    : `/api/projects/${asset.projectId}/assets/${asset.id}/download`;
  const notes: ProjectAssetNote[] = (asset.notes ?? []).map(n => ({
    id: n.id,
    author: n.author.name,
    body: n.body,
    createdAt: n.createdAt.toISOString()
  }));
  return {
    id: asset.id,
    name: asset.name,
    type: asset.type,
    category: mapProjectAssetCategory(asset.category),
    versionGroup: asset.versionGroup,
    versionNumber: asset.versionNumber,
    fileSizeBytes: asset.fileSizeBytes,
    isLink,
    downloadUrl,
    createdAt: asset.createdAt.toISOString(),
    notes
  };
}

export function mapAuthUser(user: User & { oauthAccounts?: OAuthAccount[] }): AuthUser {
  const googleAccount = user.oauthAccounts?.find((account) => account.provider === 'google');

  // Custom upload takes priority; fall back to Google profile photo.
  // Include updatedAt as a version param so the browser always fetches
  // a fresh image after each upload instead of serving a stale cached copy.
  const avatarUrl = user.avatarStorageKey
    ? `/api/auth/me/avatar?v=${user.updatedAt.getTime()}`
    : (user.avatarUrl ?? null);

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl,
    hasPassword: Boolean(user.passwordHash),
    googleDriveConnected: Boolean(googleAccount)
  };
}

export function mapProjectSummary(
  project: {
    id: string;
    title: string;
    description: string;
    genre: string;
    coverImageKey: string | null;
    driveSyncStatus: string;
    _count: { songs: number; memberships: number; projectAssets: number };
    [k: string]: unknown;
  }
): ProjectSummary {
  const out = {
    id: project.id,
    title: project.title,
    description: project.description,
    genre: project.genre,
    released: Boolean(project.released),
    songCount: project._count.songs,
    projectAssetCount: project._count.projectAssets,
    collaboratorCount: project._count.memberships,
    driveSyncStatus: mapSyncStatus(project.driveSyncStatus),
    coverImageUrl: project.coverImageKey ? `/api/projects/${project.id}/cover` : null
  };

  return out as unknown as ProjectSummary;
}

export function mapSongSummary(
  song: Song & { assets: Array<{ id: string }>; tasks: Task[] }
): SongSummary {
  const out = {
    id: song.id,
    title: song.title,
    released: Boolean((song as any).released),
    status: song.status,
    assetCount: song.assets.length + ((song as any).shotListUrl ? 1 : 0),
    taskOpenCount: song.tasks.filter((task) => task.status !== 'Done').length
  };

  return out as unknown as SongSummary;
}

export function mapProjectDetails(
  project: Project & {
    songs: Array<Song & { assets: Array<{ id: string }>; tasks: Task[] }>;
    _count?: { projectAssets: number };
  }
): ProjectDetails {
  const out = {
    id: project.id,
    title: project.title,
    description: project.description,
    genre: project.genre,
    released: Boolean((project as any).released),
    projectAssetCount: project._count?.projectAssets ?? 0,
    driveSyncStatus: mapSyncStatus(project.driveSyncStatus),
    driveFolderId: project.driveFolderId,
    coverImageUrl: project.coverImageKey ? `/api/projects/${project.id}/cover` : null,
    songs: project.songs.map(mapSongSummary)
  };

  return out as unknown as ProjectDetails;
}

export function mapSongWorkspace(
  song: Song & {
    assets: Array<{
      id: string;
      name: string;
      type: string;
      category: string;
      versionGroup: string;
      versionNumber: number;
      duration: string | null;
      sampleRateHz: number | null;
      bitrateKbps: number | null;
      codec: string | null;
      channels: number | null;
      fileSizeBytes: number | null;
      container: string | null;
      createdAt: Date;
      notes: Array<{ id: string; body: string; createdAt: Date; author: User }>;
    }>;
    notes: Array<{ id: string; body: string; createdAt: Date; author: User }>;
    tasks: Array<{ id: string; title: string; status: string; assignee: User | null }>;
  },
  projectTitle = ''
): SongWorkspace {
  const out = {
    id: song.id,
    projectId: song.projectId,
    projectTitle,
    title: song.title,
    released: Boolean((song as any).released),
    status: song.status,
    lyrics: song.lyrics ?? null,
    key: song.keySignature ?? null,
    bpm: song.bpm ?? null,
    shotListUrl: (song as any).shotListUrl ?? null,
    assets: song.assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      type: asset.type,
      category: mapAssetCategory(asset.category),
      versionGroup: asset.versionGroup,
      versionNumber: asset.versionNumber,
      duration: asset.duration,
      sampleRateHz: asset.sampleRateHz,
      bitrateKbps: asset.bitrateKbps,
      codec: asset.codec,
      channels: asset.channels,
      fileSizeBytes: asset.fileSizeBytes,
      container: asset.container,
      mediaKind: inferMediaKind(asset.type, asset.name),
      streamUrl: `/api/assets/${asset.id}/stream`,
      downloadUrl: `/api/assets/${asset.id}/download`,
      createdAt: asset.createdAt.toISOString(),
      notes: asset.notes.map(
        (note): SongAssetNote => ({
          id: note.id,
          author: note.author.name,
          body: note.body,
          createdAt: note.createdAt.toISOString()
        })
      )
    })),
    notes: song.notes.map(
      (note): SongNote => ({
        id: note.id,
        author: note.author.name,
        body: note.body,
        createdAt: note.createdAt.toISOString()
      })
    ),
    tasks: song.tasks.map(
      (task): SongTask => ({
        id: task.id,
        title: task.title,
        assignee: task.assignee?.name ?? null,
        status: mapTaskStatus(task.status)
      })
    )
  };

  return out as unknown as SongWorkspace;
}
