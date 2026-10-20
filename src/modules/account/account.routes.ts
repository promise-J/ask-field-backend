import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validate } from '../../middlewares/validate';
import { authLimiter } from '../../middlewares/rateLimiter.middleware';
import { asyncHandler } from '../../utils/asyncHandler';
import { apiSuccessResponse } from '../../utils/apiResponse';
import { sendCode, checkCode } from '../verification/verification.service';
import * as settings from './settings.service';
import * as data from './data.service';
import * as help from './help.service';
import { HELP_TOPICS, REPORT_REASONS } from './models';

/** Participant Stage 7 (canvas 7.1–7.4), mounted under /api/participants/me (participant token required). */
const router = Router();
const id = (req: Request) => req.user!.id;
const ok = (fn: (req: Request) => Promise<unknown>, message = 'ok') => asyncHandler(async (req: Request, res: Response) => apiSuccessResponse(res, message, await fn(req)));

const password = z.string().min(8, 'Use at least 8 characters.').max(200);
const emailSchema = z.object({ email: z.string().trim().email('Enter a valid email.').max(200), password: z.string().max(200).optional() });
const passwordSchema = z.object({ current: z.string().max(200).optional(), next: password });
const prefsSchema = z.object({ studies: z.boolean(), messages: z.boolean(), news: z.boolean() }).partial();
const phoneSchema = z.object({ phone: z.string().trim().min(6, 'Enter your phone number.').max(24), channel: z.enum(['whatsapp', 'sms']).default('whatsapp') });
const codeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.') });
const closeSchema = z.object({ password: z.string().max(200).optional(), giveUp: z.boolean().optional() });
const contactSchema = z.object({
  topic: z.enum(HELP_TOPICS),
  message: z.string().trim().min(20, 'Tell us a bit more (at least 20 characters).').max(4000),
  surveyId: z.string().max(40).optional(),
});
const reportSchema = z.object({ reason: z.enum(REPORT_REASONS), message: z.string().trim().max(2000).optional() });

// 7.1 Settings
router.get('/settings', ok((r) => settings.settings(id(r))));
router.post('/settings/email', authLimiter, validate(emailSchema), ok((r) => settings.requestEmailChange(id(r), r.body), 'Check your new inbox for a link.'));
router.delete('/settings/email', ok((r) => settings.cancelEmailChange(id(r)), 'Cancelled.'));
router.post('/settings/password', authLimiter, validate(passwordSchema), ok((r) => settings.changePassword(id(r), r.body, r.user!.sid), 'Password changed. Your other devices are signed out.'));
router.post('/settings/phone/send', authLimiter, validate(phoneSchema), ok(async (r) => sendCode(id(r), r.body.phone, r.body.channel, { change: true }), 'We sent a code to the new number.'));
router.post('/settings/phone/verify', authLimiter, validate(codeSchema), ok(async (r) => {
  await checkCode(id(r), r.body.code);
  return settings.settings(id(r));
}, 'Number changed.'));
router.put('/settings/email-prefs', validate(prefsSchema), ok((r) => settings.setEmailPrefs(id(r), r.body), 'Saved.'));
router.post('/settings/sign-out-others', ok((r) => settings.signOutOthers(id(r), r.user!.sid), 'Signed out everywhere else.'));

// 7.2 Your data
router.get('/data.json', asyncHandler(async (req: Request, res: Response) => {
  const body = await data.exportData(id(req));
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="joinstudy-my-data-${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(JSON.stringify(body, null, 2));
}));
router.get('/close', ok((r) => data.closeCheck(id(r))));
router.post('/close', authLimiter, validate(closeSchema), ok((r) => data.closeAccount(id(r), r.body), 'Your account is closed.'));

// 7.3 Help, 7.4 Report a study
router.post('/help/contact', authLimiter, validate(contactSchema), ok((r) => help.contact(id(r), r.body), 'Sent.'));
router.get('/studies/:id/report', ok((r) => help.reportForm(id(r), String(r.params.id))));
router.post('/studies/:id/report', authLimiter, validate(reportSchema), ok((r) => help.report(id(r), String(r.params.id), r.body), 'Thanks, we’ve got it.'));

export default router;

/** The link in the "confirm your new email" email. No sign-in needed. Mounted at /api/participants/settings. */
export const publicAccountRoutes = Router();
publicAccountRoutes.post('/confirm-email', authLimiter, validate(z.object({ token: z.string().min(10).max(200) })), ok((r) => settings.confirmEmailChange(r.body.token), 'Your email is changed.'));
