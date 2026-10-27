import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler';
import { apiSuccessResponse } from '../../utils/apiResponse';
import { authMiddleware, requireRole } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate';
import { closedStudies, finishView, resultsCsv, runAgain, setReturnTo, statementDocument } from './finish.service';

/** Stage 8: finish a study. Mounted at the API root; every route checks auth itself. */
export const returnToSchema = z.object({ to: z.enum(['credit', 'card']) });

const router = Router();
const researcher = [authMiddleware, requireRole('researcher')];
const ok = (fn: (req: Request) => Promise<unknown>, message = 'ok', code = 200) => asyncHandler(async (req: Request, res: Response) => apiSuccessResponse(res, message, await fn(req), code));

router.get('/surveys/:id/finish', ...researcher, ok((r) => finishView(r.user!.id, r.params.id)));
router.post('/surveys/:id/finish/return-to', ...researcher, validate(returnToSchema), ok((r) => setReturnTo(r.user!.id, r.params.id, r.body.to), 'Saved.'));
router.post('/surveys/:id/run-again', ...researcher, ok((r) => runAgain(r.user!.id, r.params.id), 'Copied.', 201));
router.get('/researchers/me/closed-studies', ...researcher, ok((r) => closedStudies(r.user!.id)));
router.get('/surveys/:id/results.csv', ...researcher, asyncHandler(async (req: Request, res: Response) => {
  const show = ['approved', 'other'].includes(String(req.query.show)) ? (req.query.show as 'approved' | 'other') : 'all';
  const { csv, filename } = await resultsCsv(req.user!.id, req.params.id, show);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}));
router.get('/surveys/:id/statement', ...researcher, asyncHandler(async (req: Request, res: Response) => {
  res.type('html').send(await statementDocument(req.user!.id, req.params.id));
}));

export default router;
