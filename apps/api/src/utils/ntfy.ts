import { prisma } from '../lib/prisma.js';

// Public ntfy server. Users configure a topic name only (see feature scope);
// the whole team subscribes to that topic in the ntfy app to receive pushes.
const NTFY_SERVER = 'https://ntfy.sh';

// ntfy topic names allow letters, numbers, underscores and dashes only.
export const NTFY_TOPIC_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidNtfyTopic(topic: string): boolean {
  return NTFY_TOPIC_REGEX.test(topic);
}

// HTTP header values must be Latin-1; strip anything outside that range so a
// unicode song/project title can never throw when set as an ntfy header.
function sanitizeHeader(value: string): string {
  return value.replace(/[^ -ÿ]/g, '').trim();
}

/**
 * Publish a message to an ntfy topic. Never throws — returns whether the POST
 * succeeded. Bounded by a 3s timeout so it stays Vercel-safe (awaited inline)
 * without meaningfully slowing the calling request.
 */
export async function publishToTopic(
  topic: string,
  message: string,
  opts: { title?: string; tags?: string; click?: string } = {}
): Promise<boolean> {
  if (!topic || !isValidNtfyTopic(topic)) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const headers: Record<string, string> = {};
    if (opts.title) {
      const title = sanitizeHeader(opts.title);
      if (title) headers['Title'] = title;
    }
    if (opts.tags) headers['Tags'] = opts.tags;
    if (opts.click) headers['Click'] = opts.click;

    const res = await fetch(`${NTFY_SERVER}/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers,
      body: message,
      signal: controller.signal
    });
    return res.ok;
  } catch (err) {
    console.warn('[ntfy] publish failed', err);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Read a project's owner topic + display context via raw SQL, so it keeps
 * working even if the Prisma client has not been regenerated for the
 * `ntfyTopic` column yet (mirrors the codebase's pattern for `released`).
 * Returns null (never throws) if the lookup fails or the column is missing.
 */
export async function getProjectOwnerTopic(
  projectId: string
): Promise<{ topic: string | null; title: string; artist: string } | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<
      Array<{ topic: string | null; title: string; artist: string }>
    >(
      `SELECT u."ntfyTopic" AS topic, p."title" AS title, p."artist" AS artist
       FROM "Project" p
       JOIN "User" u ON u."id" = p."createdById"
       WHERE p."id" = $1`,
      projectId
    );
    return rows[0] ?? null;
  } catch (err) {
    console.warn('[ntfy] owner topic lookup failed', err);
    return null;
  }
}

/**
 * Notify the project team that song audio was uploaded. Sends to the project
 * owner's shared topic. No-op when no topic is configured. Never throws.
 */
export async function notifySongAudioUploaded(params: {
  projectId: string;
  songTitle: string;
  isNewVersion: boolean;
}): Promise<void> {
  const info = await getProjectOwnerTopic(params.projectId);
  if (!info?.topic) return;

  const message = params.isNewVersion
    ? `${params.songTitle}: new version uploaded!`
    : `New song ${params.songTitle} uploaded!`;
  const title = [info.artist, info.title].filter(Boolean).join(' - ') || 'StudioFlow';

  await publishToTopic(info.topic, message, { title, tags: 'musical_note' });
}
