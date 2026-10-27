import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler';
import { apiSuccessResponse } from '../../utils/apiResponse';
import { authMiddleware, requireRole } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate';
import { decide, reviewView, saveAttendance, toReview } from './review.service';
import { answer } from '../after/after.service';

/** Stage 7: review the work. Mounted at the API root; every route checks auth itself. */

const id = z.string().regex(/^[a-f\d]{24}$/i, 'Something in that list isn’t valid.');
export const decideSchema = z.object({
  ids: z.array(id).min(1, 'Choose at least one.').max(500, 'Up to 500 at a time.'),
  decision: z.enum(['approve', 'reject']),
  reason: z.enum(['tasks', 'attention', 'low-effort', 'not-eligible', 'other']).optional(),
  note: z.string().trim().max(1000, 'Keep the note under 1,000 characters.').optional(),
});
export const attendanceSchema = z.object({ joined: z.array(id).max(100).default([]), missed: z.array(id).max(100).default([]) }).refine((v) => v.joined.length + v.missed.length > 0, { message: 'Mark at least one person.' });

const router = Router();
const researcher = [authMiddleware, requireRole('researcher')];
const ok = (fn: (req: Request) => Promise<unknown>, message = 'ok') => asyncHandler(async (req: Request, res: Response) => apiSuccessResponse(res, message, await fn(req)));

router.get('/researchers/me/to-review', ...researcher, ok((r) => toReview(r.user!.id)));
router.get('/surveys/:id/review', ...researcher, ok((r) => reviewView(r.user!.id, r.params.id)));
router.post('/surveys/:id/review', ...researcher, validate(decideSchema), ok((r) => decide(r.user!.id, r.params.id, r.body), 'Saved.'));
// Participant Stage 5: answer a question about a decision (approve it after all, or keep it with a reply).
const answerSchema = z.object({ decision: z.enum(['approve', 'keep']), reply: z.string().trim().max(2000, 'Keep it under 2,000 characters.').optional() });
router.post('/surveys/:id/review/:actionId/answer', ...researcher, validate(answerSchema), ok((r) => answer(r.user!.id, r.params.id, r.params.actionId, r.body), 'Answered.'));
router.post('/surveys/:id/attendance', ...researcher, validate(attendanceSchema), ok((r) => saveAttendance(r.user!.id, r.params.id, r.body), 'Attendance saved.'));

export default router;
