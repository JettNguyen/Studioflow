import type { Request, Response, NextFunction } from 'express';
import type { ProjectRole } from '@studioflow/shared';

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: ProjectRole;
  };
}

export function requireRole(allowedRoles: ProjectRole[]) {
  return function roleGuard(req: AuthRequest, res: Response, next: NextFunction) {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }

    next();
  };
}
