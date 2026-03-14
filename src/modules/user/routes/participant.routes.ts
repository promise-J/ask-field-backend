import { Router } from 'express';
import { createUser, getUser, googleAuth, verifyEmail } from '../controllers/participant.controller';
import { validate } from '../../../middlewares/validate';
import { createParticipantSchema, verifyEmailQuerySchema } from '../user.validation';
import { validateQuery } from '../../../middlewares/validateQuery';

const router = Router();

router.post('/auth/register', validate(createParticipantSchema),createUser);
router.get('/auth/verify-email', verifyEmail);
router.post('/auth/google-auth', googleAuth);
router.get('/:id', getUser);

export default router;
