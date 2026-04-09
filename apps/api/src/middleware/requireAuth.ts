import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { mapAuthUser } from '../utils/mappers.js';

export async function attachCurrentUser(req: Request, _res: Response, next: NextFunction) {
  if (!req.session.userId) {
    req.user = undefined;
    return next();
  }

  const user = await prisma.user.findUnique({
    where: { id: req.session.userId },
    include: {
      oauthAccounts: {
        where: { provider: 'google' }
      }
    }
  });

  req.user = user ? mapAuthUser(user) : undefined;
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  next();
}
