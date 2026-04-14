export type ProjectRole = 'Owner' | 'Editor' | 'Viewer';

export type ProjectSyncStatus = 'Not Linked' | 'Healthy' | 'Syncing' | 'Needs Attention';

export type SongTaskStatus = 'Open' | 'In Review' | 'Done';

export type AssetCategory = 'Song Audio' | 'Social Media Content' | 'Videos' | 'Beat' | 'Stems';

export type ProjectAssetCategory = 'Shot List' | 'Filming Clip' | 'Trailer Version' | 'Trailer Audio' | 'Other';

export interface ProjectAsset {
  id: string;
  name: string;
  type: string;
  category: ProjectAssetCategory;
  versionGroup: string;
  versionNumber: number;
  fileSizeBytes: number | null;
  isLink: boolean;
  downloadUrl: string;
  createdAt: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  hasPassword: boolean;
  googleDriveConnected: boolean;
}

export interface AuthSessionResponse {
  user: AuthUser | null;
}

export interface SignupRequest {
  email: string;
  password: string;
  name: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface ProjectSummary {
  id: string;
  title: string;
  description: string;
  genre: string;
  released: boolean;
  songCount: number;
  projectAssetCount: number;
  collaboratorCount: number;
  driveSyncStatus: ProjectSyncStatus;
  coverImageUrl: string | null;
}

export interface SongSummary {
  id: string;
  title: string;
  released: boolean;
  status: string;
  assetCount: number;
  taskOpenCount: number;
}

export interface ProjectDetails {
  id: string;
  title: string;
  description: string;
  genre: string;
  released: boolean;
  projectAssetCount: number;
  driveSyncStatus: ProjectSyncStatus;
  driveFolderId: string | null;
  coverImageUrl: string | null;
  songs: SongSummary[];
}

export interface SongAsset {
  id: string;
  name: string;
  type: string;
  category: AssetCategory;
  versionGroup: string;
  versionNumber: number;
  duration: string | null;
  sampleRateHz: number | null;
  bitrateKbps: number | null;
  codec: string | null;
  channels: number | null;
  fileSizeBytes: number | null;
  container: string | null;
  mediaKind: 'audio' | 'video' | 'other';
  streamUrl: string | null;
  downloadUrl: string | null;
  createdAt: string;
  notes: SongAssetNote[];
}

export interface SongAssetNote {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface SongNote {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface SongTask {
  id: string;
  title: string;
  assignee: string | null;
  status: SongTaskStatus;
}

export interface SongWorkspace {
  id: string;
  projectId: string;
  projectTitle: string;
  title: string;
  released: boolean;
  status: string;
  lyrics: string | null;
  key: string | null;
  bpm: number | null;
  shotListUrl: string | null;
  assets: SongAsset[];
  notes: SongNote[];
  tasks: SongTask[];
}

export interface CreateProjectRequest {
  title: string;
  description?: string;
  genre?: string;
}

export interface CreateSongRequest {
  title: string;
  status?: string;
  key?: string;
  bpm?: number;
}

export interface CreateNoteRequest {
  body: string;
}

export interface CreateTaskRequest {
  title: string;
  assigneeUserId?: string;
}

export interface CreateAssetNoteRequest {
  body: string;
}

export interface UpdateTaskStatusRequest {
  status: SongTaskStatus;
}

export interface DriveConnectionStatus {
  connected: boolean;
  email: string | null;
  scopes: string[];
}

export interface AiSuggestion {
  id: string;
  songId: string;
  kind: 'bpm-key-detection' | 'note-summary' | 'stem-label';
  confidence: number;
  payload: Record<string, string | number | boolean>;
  createdAt: string;
}
