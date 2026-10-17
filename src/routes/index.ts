import { Router } from 'express';
import { config, env } from '../config/env';
import participantRoutes from '../modules/user/routes/participant.routes';
import researcherRoutes from '../modules/user/routes/researcher.routes';
import projectRoutes from '../modules/project/project.routes';
import surveyRoutes from '../modules/survey/survey.routes';
import leadRoutes from '../modules/leads/lead.routes';
import billingRoutes from '../modules/billing/billing.routes';
import authRoutes from '../modules/user/routes/auth.routes';
import runRoutes from '../modules/run/run.routes';
import reviewRoutes from '../modules/review/review.routes';

const router = Router();

// Public prices for the website and the study builder.
router.get('/pricing', (_req, res) =>
  res.json({ success: true, message: 'ok', data: { platformFeeRate: config.platformFeeRate, academicFeeRate: config.academicFeeRate, minPayoutAmount: config.minPayoutAmount, minHourlyPay: config.minHourlyPay, currency: env.DEFAULT_CURRENCY } })
);
router.get('/health', (_req, res) => res.json({ success: true, message: 'ok', data: { time: new Date().toISOString() } }));
router.use('/auth', authRoutes);
// Stage 6 (live studies, bookings, messages): before the older routers so its paths win.
router.use('/', runRoutes);
router.use('/', reviewRoutes); // Stage 7
router.use('/billing', billingRoutes);
router.use('/participants', participantRoutes);
router.use('/researchers', researcherRoutes);
router.use('/projects', projectRoutes);
router.use('/surveys', surveyRoutes);
router.use('/', leadRoutes);

export default router;
