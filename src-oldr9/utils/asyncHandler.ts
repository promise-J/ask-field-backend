import { Request, Response, NextFunction } from 'express';

export const asyncHandler =
  (fn: Function) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next);
// Compare this snippet from src/modules/user/user.routes.ts: