import cors from 'cors';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import morgan from 'morgan';
import connectPgSimple from 'connect-pg-simple';
import { Pool } from 'pg';
import { passport } from './auth/passport.js';
import { env } from './config.js';
import { attachCurrentUser } from './middleware/requireAuth.js';
import { assetRouter } from './routes/assets.js';
import { authRouter } from './routes/auth.js';
import { healthRouter } from './routes/health.js';
import { projectRouter } from './routes/projects.js';
import { songRouter } from './routes/songs.js';
import { debugRouter } from './routes/debug.js';

export function createApp() {
  const app = express();
  const PgSession = connectPgSimple(session);
  const sessionPool = new Pool({ connectionString: env.databaseUrl });

  if (env.nodeEnv === 'production') {
    app.set('trust proxy', 1);
  }

  app.use(helmet());
  app.use(
    cors({
      origin: env.clientOrigin,
      credentials: true
    })
  );
  app.use(express.json({ limit: '10mb' }));
  app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));
  app.use(
    session({
      store: new PgSession({
        pool: sessionPool,
        createTableIfMissing: true,
        tableName: 'user_sessions'
      }),
      secret: env.jwtSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: env.nodeEnv === 'production' ? 'none' : 'lax',
        secure: env.nodeEnv === 'production',
        maxAge: 1000 * 60 * 60 * 24 * 14
      }
    })
  );
  app.use(passport.initialize());
  app.use(passport.session());
  app.use(attachCurrentUser);

  app.get('/', (_req, res) => {
    res.json({
      name: 'studioflow-api',
      status: 'ok'
    });
  });

  app.get('/api', (_req, res) => {
    res.json({
      name: 'studioflow-api',
      version: '0.1.0'
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/health', healthRouter);
  app.use('/api/projects', projectRouter);
  app.use('/api/songs', songRouter);
  app.use('/api/assets', assetRouter);

  // Development-only debug routes
  if (env.nodeEnv !== 'production') {
    app.use('/api/debug', debugRouter);
  }

  return app;
}
