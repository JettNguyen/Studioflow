import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config.js';
import { healthRouter } from './routes/health.js';
import { projectRouter } from './routes/projects.js';
import { songRouter } from './routes/songs.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.clientOrigin,
      credentials: true
    })
  );
  app.use(express.json({ limit: '10mb' }));
  app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

  app.get('/api', (_req, res) => {
    res.json({
      name: 'studioflow-api',
      version: '0.1.0'
    });
  });

  app.use('/api/health', healthRouter);
  app.use('/api/projects', projectRouter);
  app.use('/api/songs', songRouter);

  return app;
}
