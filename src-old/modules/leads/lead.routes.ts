import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate } from '../../middlewares/validate';
import { authLimiter } from '../../middlewares/rateLimiter.middleware';
import { asyncHandler } from '../../utils/asyncHandler';
import { apiSuccessResponse } from '../../utils/apiResponse';
import { sendMail } from '../../utils/mailer';
import { env } from '../../config/env';
import { LeadModel } from './lead.model';

const text = (max: number) => z.string().trim().max(max).optional();

export const leadSchema = z.object({
  type: z.enum(['waitlist', 'founding-lab', 'request-country', 'ai-pilot']).default('waitlist'),
  email: z.string().trim().email('Enter a valid email address.'),
  name: text(120),
  organization: text(160),
  role: text(120),
  country: text(80),
  message: text(2000),
  source: text(80),
  details: z.record(z.string(), z.union([z.string().max(500), z.number(), z.boolean()])).optional(),
});

const THANKS: Record<string, string> = {
  waitlist: "You're on the list. We'll email you when it's your turn.",
  'founding-lab': "Thanks for applying. We'll reply within 2 working days.",
  'request-country': "Thanks. We'll let you know when we can recruit there.",
  'ai-pilot': "Thanks. We'll be in touch within 2 working days to scope your pilot.",
};

const save = asyncHandler(async (req: Request, res: Response) => {
  const { type, email, ...rest } = req.body as z.infer<typeof leadSchema>;
  // Submitting twice updates the same row instead of failing.
  await LeadModel.updateOne({ type, email: email.toLowerCase() }, { $set: rest, $setOnInsert: { type, email } }, { upsert: true });
  if (type !== 'waitlist') {
    await sendMail({
      to: env.LEADS_INBOX,
      subject: `New ${type} request from ${rest.organization || rest.name || email}`,
      text: JSON.stringify({ type, email, ...rest }, null, 2),
    });
  }
  apiSuccessResponse(res, THANKS[type], { type, email }, 201);
});

const router = Router();
router.post('/leads', authLimiter, validate(leadSchema), save);
// Short alias for the homepage waitlist form.
router.post('/waitlist', authLimiter, (req: Request, _res: Response, next: NextFunction) => { req.body = { ...req.body, type: 'waitlist' }; next(); }, validate(leadSchema), save);

export default router;
