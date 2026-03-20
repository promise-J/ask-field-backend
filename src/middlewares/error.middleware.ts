import { Request, Response, NextFunction } from 'express';
import { env } from '../config';

export function errorMiddleware(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  const statusCode = err.statusCode || 500;

  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error',
    stack: env.NODE_ENV === 'production' ? undefined : err.stack,
  });
}
