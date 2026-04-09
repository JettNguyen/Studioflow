export type ProjectRole = 'Owner' | 'Editor' | 'Viewer';

export interface ProjectSummary {
  id: string;
  title: string;
  description: string;
  genre: string;
  songCount: number;
  collaboratorCount: number;
}

export interface SongSummary {
  id: string;
  title: string;
  status: string;
  assetCount: number;
  taskOpenCount: number;
}

export interface ProjectDetails {
  id: string;
  title: string;
  description: string;
  driveSyncStatus: 'Healthy' | 'Syncing' | 'Needs Attention';
  songs: SongSummary[];
}

export interface SongAsset {
  id: string;
  name: string;
  type: string;
  duration: string;
}

export interface SongNote {
  id: string;
  author: string;
  body: string;
}

export interface SongTask {
  id: string;
  title: string;
  assignee: string;
  status: 'Open' | 'In Review' | 'Done';
}

export interface SongWorkspace {
  id: string;
  title: string;
  key: string;
  bpm: number;
  assets: SongAsset[];
  notes: SongNote[];
  tasks: SongTask[];
}

export interface AuditLogItem {
  id: string;
  actorUserId: string;
  action: 'FILE_DOWNLOADED' | 'ROLE_CHANGED' | 'COLLABORATOR_INVITED';
  resourceType: 'project' | 'song' | 'asset';
  resourceId: string;
  createdAt: string;
}

export interface DriveSyncJob {
  id: string;
  projectId: string;
  direction: 'pull' | 'push';
  status: 'queued' | 'running' | 'failed' | 'completed';
  lastMessage?: string;
  updatedAt: string;
}

export interface AiSuggestion {
  id: string;
  songId: string;
  kind: 'bpm-key-detection' | 'note-summary' | 'stem-label';
  confidence: number;
  payload: Record<string, string | number | boolean>;
  createdAt: string;
}
