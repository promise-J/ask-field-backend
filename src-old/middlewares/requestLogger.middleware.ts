import { Request, Response, NextFunction } from 'express';
import logger from '../config/logger';

export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;

    const logPayload = {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
    };

    if (res.statusCode >= 500) {
      logger.error(logPayload, 'HTTP request failed');
    } else if (res.statusCode >= 400) {
      logger.warn(logPayload, 'HTTP request warning');
    } else {
      logger.info(logPayload, 'HTTP request completed');
    }
  });

  next();
}
