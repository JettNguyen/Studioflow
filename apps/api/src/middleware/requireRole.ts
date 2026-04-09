import type { Request, Response, NextFunction } from 'express';
import type { ProjectRole } from '@studioflow/shared';

type RoleRequest = Request & {
  user?: Express.User & {
    role?: ProjectRole;
  };
};

export function requireRole(allowedRoles: ProjectRole[]) {
  return function roleGuard(req: RoleRequest, res: Response, next: NextFunction) {
    if (!req.user?.role || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }

    next();
  };
}
