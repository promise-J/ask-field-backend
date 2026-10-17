import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import routes from './routes';
import { rateLimiter } from './middlewares/rateLimiter.middleware';
import { requestLogger } from './middlewares/requestLogger.middleware';
import errorController from './error-helpers/error.controller';
import AppError from './error-helpers/appError';
import { stripeWebhook } from './modules/billing/billing.routes';
import { env, config } from './config/env';

const app = express();

// Behind a load balancer (Render, Railway, Nginx…) so rate limits see the real client IP.
app.set('trust proxy', 1);
app.use(helmet());
app.use(
  cors({
    // In production only the listed sites can call the API. In development any origin works.
    origin: config.corsOrigins.length ? config.corsOrigins : env.NODE_ENV !== 'production',
    allowedHeaders: ['Content-Type', 'Authorization', 'token'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })
);

if (env.NODE_ENV !== 'test') {
  app.use(requestLogger);
  app.use(morgan('dev'));
}
// Stripe signs the raw body, so its webhook must skip the JSON parser.
app.post('/api/billing/webhook', express.raw({ type: 'application/json', limit: '1mb' }), stripeWebhook);
app.use(express.json({ limit: '200kb' }));
app.use(rateLimiter);

app.use('/api', routes);

app.get('/', (_req, res) => {
  res.json({ success: true, message: 'joinStudy API', data: { docs: '/api/health' } });
});

app.all('*', (req, _res, next) => {
  next(new AppError(`Can't find ${req.method} ${req.originalUrl} on this server.`, 404));
});

app.use(errorController);

export default app;
