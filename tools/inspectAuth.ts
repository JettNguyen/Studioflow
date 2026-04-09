import 'dotenv/config';
import { prisma } from '../apps/api/src/lib/prisma.js';

async function main() {
  try {
    console.log('Inspecting recent users and OAuth accounts...');

    const users = await prisma.user.findMany({ orderBy: { createdAt: 'desc' }, take: 5 });
    console.log('Recent users:', JSON.stringify(users, null, 2));

    const oauth = await prisma.oAuthAccount.findMany({ orderBy: { id: 'desc' }, take: 10 });
    console.log('Recent OAuth accounts:', JSON.stringify(oauth, null, 2));

    try {
      const sessions = await prisma.$queryRawUnsafe('SELECT sid, sess, expire FROM user_sessions ORDER BY expire DESC LIMIT 5');
      console.log('Recent sessions:', JSON.stringify(sessions, null, 2));
    } catch (err) {
      console.warn('Could not query user_sessions table directly:', err?.message ?? err);
    }
  } catch (err) {
    console.error('Error inspecting auth state:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
