import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler';
import { apiSuccessResponse } from '../../utils/apiResponse';
import { authMiddleware, requireAdmin, requireRole } from '../../middlewares/auth.middleware';
import { authLimiter } from '../../middlewares/rateLimiter.middleware';
import { validate } from '../../middlewares/validate';
import { acceptInvite, changeRole, invite, inviteInfo, leave, removeMember, resendInvite, teamView, workspacesFor } from './team.service';
import { billingDetails, changePassword, closeAccount, closeBlockers, confirmEmailChange, paymentsCsv, requestEmailChange, saveBillingDetails, setEmailPrefs, settings, updateName } from './account.service';

/** Stage 9: team, settings and billing details. Mounted at the API root; every route checks auth itself. */

const role = z.enum(['admin', 'researcher', 'viewer']);
const password = z.string().min(8, 'Use at least 8 characters.').max(200);
export const inviteSchema = z.object({ email: z.string().trim().email('Enter a valid email.'), role });
export const roleSchema = z.object({ role });
export const nameSchema = z.object({ firstName: z.string().trim().min(1, 'Add your first name.').max(80), lastName: z.string().trim().max(80).default('') });
export const emailSchema = z.object({ email: z.string().trim().email('Enter a valid email.'), password: z.string().max(200).optional() });
export const passwordSchema = z.object({ current: z.string().max(200).optional(), next: password });
export const prefsSchema = z.object({ bookings: z.boolean(), messages: z.boolean(), review: z.boolean(), finish: z.boolean(), news: z.boolean() }).partial();
export const closeSchema = z.object({ confirm: z.string(), password: z.string().max(200).optional() });
export const billingSchema = z.object({
  name: z.string().trim().min(1, 'Add the name for receipts.').max(160),
  organization: z.string().trim().max(200).default(''),
  email: z.string().trim().email('Enter a valid email for receipts.'),
  cc: z.union([z.literal(''), z.string().trim().email('Enter a valid email to copy, or leave it empty.')]).default(''),
  reference: z.string().trim().max(120).default(''),
  country: z.string().trim().min(2, 'Choose a country.').max(80),
});

const router = Router();
const researcher = [authMiddleware, requireRole('researcher')];
const ok = (fn: (req: Request) => Promise<unknown>, message = 'ok', code = 200) => asyncHandler(async (req: Request, res: Response) => apiSuccessResponse(res, message, await fn(req), code));
const self = (r: Request) => r.user!.selfId || r.user!.id;

// Workspaces and team
router.get('/researchers/me/workspaces', ...researcher, ok((r) => workspacesFor(self(r))));
router.get('/researchers/me/team', ...researcher, ok((r) => teamView(r.user!.id, self(r), r.user!.role || 'owner')));
router.post('/team/invites', ...researcher, requireAdmin, validate(inviteSchema), ok((r) => invite(r.user!.id, self(r), r.body), 'Invite sent.', 201));
router.post('/team/invites/:id/resend', ...researcher, requireAdmin, ok((r) => resendInvite(r.user!.id, self(r), r.params.id), 'Invite sent again.'));
router.put('/team/members/:id', ...researcher, requireAdmin, validate(roleSchema), ok((r) => changeRole(r.user!.id, self(r), r.user!.role || 'owner', r.params.id, r.body.role), 'Role changed.'));
router.delete('/team/members/:id', ...researcher, requireAdmin, ok((r) => removeMember(r.user!.id, r.user!.role || 'owner', r.params.id), 'Removed.'));
router.post('/team/leave/:workspaceId', ...researcher, ok((r) => leave(self(r), r.params.workspaceId), 'You left the workspace.'));
router.get('/team/invite/:token', ...authLimiter, ok((r) => inviteInfo(r.params.token)));
router.post('/team/invite/:token/accept', ...researcher, ok((r) => acceptInvite(r.params.token, self(r)), 'Welcome to the workspace.'));

// Your own settings
router.get('/researchers/me/account', ...researcher, ok((r) => settings(self(r))));
router.put('/researchers/me/account', ...researcher, validate(nameSchema), ok((r) => updateName(self(r), r.body), 'Saved.'));
router.post('/researchers/me/email', ...researcher, ...authLimiter, validate(emailSchema), ok((r) => requestEmailChange(self(r), r.body), 'Check your new inbox.'));
router.post('/researchers/email/confirm', ...authLimiter, ok((r) => confirmEmailChange(String(r.body?.token || '')), 'Email changed.'));
router.post('/researchers/me/password', ...researcher, ...authLimiter, validate(passwordSchema), ok((r) => changePassword(self(r), r.body), 'Password changed.'));
router.put('/researchers/me/email-prefs', ...researcher, validate(prefsSchema), ok((r) => setEmailPrefs(self(r), r.body), 'Saved.'));
router.get('/researchers/me/close', ...researcher, ok((r) => closeBlockers(self(r))));
router.post('/researchers/me/close', ...researcher, ...authLimiter, validate(closeSchema), ok((r) => closeAccount(self(r), r.body), 'Account closed.'));

// Billing (workspace)
router.get('/researchers/me/billing', ...researcher, ok((r) => billingDetails(r.user!.id)));
router.put('/researchers/me/billing', ...researcher, requireAdmin, validate(billingSchema), ok((r) => saveBillingDetails(r.user!.id, r.body), 'Saved.'));
router.get('/researchers/me/payments.csv', ...researcher, asyncHandler(async (req: Request, res: Response) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const { csv, filename } = await paymentsCsv(req.user!.id, year);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}));

export default router;
