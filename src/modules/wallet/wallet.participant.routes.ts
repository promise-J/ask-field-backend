import { Router } from 'express';
import { validate } from '../../middlewares/validate';
import { authMiddleware, requireRole } from '../../middlewares/auth.middleware';
import { payoutSchema } from '../user/user.validation';
import { participantEarnings, requestPayout, savePayoutDetails } from './wallet.controller';

// Mounted under /participants.
const router = Router();
const participantOnly = [authMiddleware, requireRole('participant')];
router.get('/earnings', ...participantOnly, participantEarnings);
router.put('/payout-details', ...participantOnly, validate(payoutSchema), savePayoutDetails);
router.post('/payouts', ...participantOnly, requestPayout);

export default router;
