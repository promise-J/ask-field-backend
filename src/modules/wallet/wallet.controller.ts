import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { apiSuccessResponse } from '../../utils/apiResponse';
import { WalletService } from './wallet.service';

const service = new WalletService();

export const participantEarnings = asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'Earnings fetched.', await service.participantSummary(req.user!.id));
});

export const researcherWallet = asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'Wallet fetched.', await service.researcherSummary(req.user!.id));
});
