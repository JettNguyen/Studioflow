import { Router } from 'express';

export const debugRouter = Router();

// Development-only: set session userId for quick testing
debugRouter.get('/login', (req, res) => {
  const { userId } = req.query as { userId?: string };

  if (!userId) {
    return res.status(400).json({ message: 'userId query param required' });
  }

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  req.session.userId = userId;

  res.json({ ok: true, userId });
});
