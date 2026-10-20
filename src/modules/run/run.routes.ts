import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler';
import { apiSuccessResponse } from '../../utils/apiResponse';
import { authMiddleware, requireRole } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate';
import { addPlaces } from '../billing/launch.service';
import * as live from './live.service';
import * as booking from './booking.service';
import * as msg from './message.service';

/** Stage 6: running a live study. Mounted at the API root; every route checks auth itself. */

const receipt = z.object({
  name: z.string().trim().min(1, 'Add the name for the receipt.').max(160),
  organization: z.string().trim().max(200).default(''),
  email: z.string().trim().email('Enter a valid email for the receipt.'),
  cc: z.union([z.literal(''), z.string().trim().email('Enter a valid email to copy, or leave it empty.')]).default(''),
  reference: z.string().trim().max(120).default(''),
  country: z.string().trim().min(2, 'Choose a country.').max(80),
});
export const addPlacesSchema = z.object({
  extra: z.number({ message: 'Enter how many places to add.' }).int('Use a whole number.').min(1, 'Add at least 1 place.').max(10000, 'Add up to 10,000 places at a time.').optional(),
  session: z.string().datetime({ offset: true, message: 'Choose a date and time.' }).optional(),
  method: z.enum(['card', 'invoice']).default('card'),
  useCredit: z.boolean().default(false),
  receipt: receipt.optional(),
});
const slot = z.string().regex(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) ([01]\d|2[0-3]):[0-5]\d$/, 'Times look like “Mon 09:00”.');
export const addTimesSchema = z.object({ weekly: z.array(slot).max(7 * 24).default([]), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.').optional() });
export const closeDateSchema = z.object({ date: z.union([z.null(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.')]) });
export const linkSchema = z.object({ url: z.string().trim().url('Enter a full link, starting with https://').max(500) });
export const bookSchema = z.object({ start: z.string().datetime({ message: 'Choose a time.' }), timeZone: z.string().max(64).optional() });
export const researcherMessageSchema = z.object({ to: z.string().min(1, 'Choose who to send it to.'), body: z.string().trim().min(1, 'Write a message first.').max(4000, 'Keep messages under 4,000 characters.') });
export const participantMessageSchema = z.object({ body: z.string().trim().min(1, 'Write a message first.').max(4000, 'Keep messages under 4,000 characters.') });

const router = Router();
const researcher = [authMiddleware, requireRole('researcher')];
const participant = [authMiddleware, requireRole('participant')];
const uid = (req: Request) => req.user!.id;
const ok = (fn: (req: Request) => Promise<unknown>, message = 'ok', code = 200) =>
  asyncHandler(async (req: Request, res: Response) => apiSuccessResponse(res, message, await fn(req), code));

// Researcher: a live study
router.get('/surveys/:id/live', ...researcher, ok((r) => live.liveView(uid(r), r.params.id)));
router.get('/surveys/:id/participants', ...researcher, ok((r) => live.participantsOf(uid(r), r.params.id)));
router.post('/surveys/:id/live/pause', ...researcher, ok((r) => live.setPaused(uid(r), r.params.id, true), 'Paused.'));
router.post('/surveys/:id/live/resume', ...researcher, ok((r) => live.setPaused(uid(r), r.params.id, false), 'Running again.'));
router.post('/surveys/:id/live/close-date', ...researcher, validate(closeDateSchema), ok((r) => live.setCloseDate(uid(r), r.params.id, r.body.date), 'Close date saved.'));
router.post('/surveys/:id/live/close', ...researcher, ok((r) => live.closeEarly(uid(r), r.params.id), 'Closed.'));
router.post('/surveys/:id/live/add-times', ...researcher, validate(addTimesSchema), ok((r) => live.addTimes(uid(r), r.params.id, r.body), 'Times added.'));
router.post('/surveys/:id/live/add-places', ...researcher, validate(addPlacesSchema), ok((r) => addPlaces(uid(r), r.params.id, { ...r.body, paidBy: r.user!.selfId }), 'ok', 201));

// Researcher: bookings
router.get('/surveys/:id/bookings', ...researcher, ok((r) => booking.bookingsForResearcher(uid(r), r.params.id)));
router.post('/bookings/:id/happened', ...researcher, ok((r) => booking.markHappened(uid(r), r.params.id), 'Marked as happened. They’ve been paid.'));
router.post('/bookings/:id/noshow', ...researcher, ok((r) => booking.markNoShow(uid(r), r.params.id), 'Marked as didn’t join.'));
router.post('/bookings/:id/link', ...researcher, validate(linkSchema), ok((r) => booking.setBookingLink(uid(r), r.params.id, r.body.url), 'Link sent.'));

// Researcher: messages
router.get('/researchers/me/messages', ...researcher, ok((r) => msg.researcherInbox(uid(r))));
router.get('/surveys/:id/messages', ...researcher, ok((r) => msg.threadsForStudy(uid(r), r.params.id)));
router.get('/surveys/:id/messages/:participantId', ...researcher, ok((r) => msg.researcherThread(uid(r), r.params.id, r.params.participantId)));
router.post('/surveys/:id/messages', ...researcher, validate(researcherMessageSchema), ok((r) => msg.researcherSend(uid(r), r.params.id, r.body), 'Sent.', 201));

// Participant: booking a time
router.get('/surveys/:id/slots', ...participant, ok((r) => booking.slotsForParticipant(uid(r), r.params.id)));
router.post('/surveys/:id/book', ...participant, validate(bookSchema), ok((r) => booking.book(uid(r), r.params.id, r.body), 'Booked.', 201));
router.post('/bookings/:id/cancel', ...participant, ok((r) => booking.cancelBooking(uid(r), r.params.id), 'Cancelled.'));
router.get('/participants/me/bookings', ...participant, ok((r) => booking.myBookings(uid(r))));

// Participant: messages
router.get('/participants/me/messages', ...participant, ok((r) => msg.participantInbox(uid(r))));
router.get('/participants/me/messages/:surveyId', ...participant, ok((r) => msg.participantThread(uid(r), r.params.surveyId)));
router.post('/participants/me/messages/:surveyId', ...participant, validate(participantMessageSchema), ok((r) => msg.participantSend(uid(r), r.params.surveyId, r.body), 'Sent.', 201));

export default router;
