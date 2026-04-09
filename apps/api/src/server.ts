import { createApp } from './app.js';
import { env } from './config.js';

const app = createApp();

app.listen(env.port, () => {
  console.log(`Studioflow API running on http://localhost:${env.port}`);
});
