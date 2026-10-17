import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { apiSuccessResponse } from '../../utils/apiResponse';
import { WalletService } from './wallet.service';

const service = new WalletService();

export const participantEarnings = asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'Earnings fetched.', await service.participantSummary(req.user!.id));
});

export const savePayoutDetails = asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'Payout details saved.', await service.savePayoutDetails(req.user!.id, req.body));
});

export const requestPayout = asyncHandler(async (req: Request, res: Response) => {
  const amount = req.body?.amount !== undefined ? Number(req.body.amount) : undefined;
  const payout = await service.requestPayout(req.user!.id, amount);
  apiSuccessResponse(res, 'Withdrawal requested. It usually arrives within 2 working days.', payout, 201);
});

export const researcherWallet = asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'Wallet fetched.', await service.researcherSummary(req.user!.id));
});
