import AppError from '../../error-helpers/appError';
import { env } from '../../config/env';

/** Participant Stage 1: kept apart from verification.service so the study code can import it without a cycle. */
export const VERIFY_FIRST: Record<string, string> = {
  review: 'We’re checking your selfie. You can take studies once that’s done, usually within 24 hours.',
  checking: 'We’re checking your selfie. It usually takes under a minute.',
  duplicate: 'This account can’t take studies: it matches another joinStudy account. Please use that one.',
  rejected: 'This account can’t take studies. Contact us if you think that’s a mistake.',
};

/** The study gate: called before anyone is let into a study (survey.service checkEligibility). */
export function assertCanTakeStudies(participant: any) {
  if (!env.REQUIRE_PARTICIPANT_VERIFICATION) return;
  const status = participant?.verification?.status || 'none';
  if (status === 'verified') return;
  throw new AppError(VERIFY_FIRST[status] || 'Get verified once to take studies. It takes about 2 minutes.', 403, 'verify_first', { status });
}

