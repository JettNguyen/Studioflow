import { prisma } from '../lib/prisma.js';

async function main() {
  console.log('Ensuring Song.position column exists...');
  // Add column if it doesn't exist (Postgres IF NOT EXISTS)
  await prisma.$executeRawUnsafe(`ALTER TABLE "Song" ADD COLUMN IF NOT EXISTS "position" integer;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Song" ADD COLUMN IF NOT EXISTS "lyrics" text;`);

  console.log('Loading songs to compute positions...');
  const songs = await prisma.song.findMany({
    orderBy: [{ projectId: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, projectId: true }
  });

  if (songs.length === 0) {
    console.log('No songs found — nothing to backfill.');
    return;
  }

  console.log(`Backfilling positions for ${songs.length} songs...`);

  const updates: Array<ReturnType<typeof prisma.song.update>> = [];
  let currentProject: string | null = null;
  let pos = 0;

  for (const s of songs) {
    if (s.projectId !== currentProject) {
      currentProject = s.projectId;
      pos = 0;
    }

    updates.push(prisma.song.update({ where: { id: s.id }, data: { position: pos } }));
    pos += 1;
  }

  // Run in a transaction (Prisma batches will be used)
  const chunkSize = 200;
  for (let i = 0; i < updates.length; i += chunkSize) {
    const chunk = updates.slice(i, i + chunkSize);
    // eslint-disable-next-line no-await-in-loop
    await prisma.$transaction(chunk);
  }

  console.log('Backfill complete.');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Backfill failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
