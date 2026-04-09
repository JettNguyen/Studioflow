import type { OAuthAccount, Project, ProjectMembership, Song, Task, User } from '@prisma/client';
import type {
  AssetCategory,
  AuthUser,
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

export function mapAuthUser(user: User & { oauthAccounts?: OAuthAccount[] }): AuthUser {
  const googleAccount = user.oauthAccounts?.find((account) => account.provider === 'google');

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl ?? null,
    hasPassword: Boolean(user.passwordHash),
    googleDriveConnected: Boolean(googleAccount)
  };
}

export function mapProjectSummary(
  project: Project & { memberships: ProjectMembership[]; songs: Song[] }
): ProjectSummary {
  return {
    id: project.id,
    title: project.title,
    description: project.description,
    genre: project.genre,
    songCount: project.songs.length,
    collaboratorCount: project.memberships.length,
    driveSyncStatus: mapSyncStatus(project.driveSyncStatus)
  };
}

export function mapSongSummary(
  song: Song & { assets: Array<{ id: string }>; tasks: Task[] }
): SongSummary {
  return {
    id: song.id,
    title: song.title,
    status: song.status,
    assetCount: song.assets.length,
    taskOpenCount: song.tasks.filter((task) => task.status !== 'Done').length
  };
}

export function mapProjectDetails(
  project: Project & {
    songs: Array<Song & { assets: Array<{ id: string }>; tasks: Task[] }>;
  }
): ProjectDetails {
  return {
    id: project.id,
    title: project.title,
    description: project.description,
    genre: project.genre,
    driveSyncStatus: mapSyncStatus(project.driveSyncStatus),
    driveFolderId: project.driveFolderId,
    songs: project.songs.map(mapSongSummary)
  };
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
  }
): SongWorkspace {
  return {
    id: song.id,
    projectId: song.projectId,
    title: song.title,
    status: song.status,
    key: song.keySignature ?? null,
    bpm: song.bpm ?? null,
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
}
