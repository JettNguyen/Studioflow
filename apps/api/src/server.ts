import { createApp } from './app.js';
import { env } from './config.js';

const app = createApp();

// Named export for Vercel serverless handler.
export default app;

// Only start the HTTP server when running outside of Vercel (local dev / Railway).
if (!process.env.VERCEL) {
  const host = '0.0.0.0';
  app.listen(env.port, host, () => {
    console.log(`Studioflow API running on http://${host}:${env.port}`);
    console.log(`Google OAuth enabled: ${env.googleEnabled}`);
    console.log(`S3 storage enabled: ${env.s3Enabled}${env.s3Enabled ? ` (bucket: ${env.s3Bucket}, endpoint: ${env.s3Endpoint})` : ''}`);
  });
}
