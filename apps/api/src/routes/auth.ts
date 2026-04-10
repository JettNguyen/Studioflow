import { Router } from 'express';
import { z } from 'zod';
import type { LoginRequest, SignupRequest } from '@studioflow/shared';
import { passport } from '../auth/passport.js';
import { env } from '../config.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { getGrantedScopes } from '../utils/drive.js';
import { mapAuthUser } from '../utils/mappers.js';

export const authRouter = Router();

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(80)
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128)
});

authRouter.get('/me', (req, res) => {
  res.json({ user: req.user ?? null });
});

authRouter.post('/signup', async (req, res) => {
  const parsed = signupSchema.safeParse(req.body satisfies SignupRequest);

  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid signup payload', errors: parsed.error.flatten() });
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: parsed.data.email }
  });

  if (existingUser) {
    return res.status(409).json({ message: 'An account already exists for this email address' });
  }

  const user = await prisma.user.create({
    data: {
      email: parsed.data.email,
      name: parsed.data.name,
      passwordHash: await hashPassword(parsed.data.password)
    },
    include: {
      oauthAccounts: {
        where: { provider: 'google' }
      }
    }
  });

  req.session.userId = user.id;

  res.status(201).json({ user: mapAuthUser(user) });
});

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body satisfies LoginRequest);

  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid login payload', errors: parsed.error.flatten() });
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    include: {
      oauthAccounts: {
        where: { provider: 'google' }
      }
    }
  });

  if (!user?.passwordHash) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  const passwordMatches = await verifyPassword(parsed.data.password, user.passwordHash);

  if (!passwordMatches) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  req.session.userId = user.id;

  res.json({ user: mapAuthUser(user) });
});

authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.status(204).send();
  });
});

authRouter.get('/google', (req, res, next) => {
  if (!env.googleEnabled) {
    return res.status(503).json({ message: 'Google OAuth is not configured yet' });
  }

  const authOptions: Record<string, unknown> = {
    accessType: 'offline',
    session: false
  };

  // Only force the consent screen when explicitly requested (e.g. reauth flow).
  // `prompt: 'consent'` makes Google show the consent screen every time,
  // so we avoid it by default to prevent repeated prompts.
  const reauth = String(req.query.reauth ?? '').toLowerCase();
  if (reauth === '1' || reauth === 'true') {
    // Useful when you need to obtain a fresh refresh token or re-consent.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore passport accepts this option in authenticate()
    authOptions.prompt = 'consent';
  }

  const authenticator = passport.authenticate('google', authOptions);

  authenticator(req, res, next);
});

authRouter.get('/google/callback', (req, res, next) => {
  if (!env.googleEnabled) {
    return res.redirect(`${env.clientOrigin}/login?error=google-not-configured`);
  }

  passport.authenticate('google', { session: false }, (error: Error | null, user) => {
    if (error || !user) {
      return res.redirect(`${env.clientOrigin}/login?error=google-auth-failed`);
    }

    req.session.userId = user.id;
    return res.redirect(`${env.clientOrigin}/`);
  })(req, res, next);
});

authRouter.get('/drive-status', requireAuth, async (req, res) => {
  const account = await prisma.oAuthAccount.findFirst({
    where: {
      userId: req.user!.id,
      provider: 'google'
    }
  });

  res.json({
    connected: Boolean(account),
    email: account?.email ?? null,
    scopes: getGrantedScopes(account)
  });
});
