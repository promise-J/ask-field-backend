import { ResearcherModel } from '../user/models/researcher.model';

/** Kinds of email a researcher can turn off in Settings (Stage 9). Receipts and security emails always go. */
export type EmailKind = 'bookings' | 'messages' | 'review' | 'finish';

/**
 * Who to email about a study: the person in the workspace who made it (or the owner, for older studies),
 * unless they've turned that kind of email off. Returns null when there's nobody to email.
 */
export async function studyContact(s: { createdBy?: unknown; userId?: unknown } | null | undefined, kind?: EmailKind) {
  const id = s?.createdBy || s?.userId;
  return researcherEmail(id, kind);
}

export async function researcherEmail(id: unknown, kind?: EmailKind) {
  if (!id) return null;
  const r: any = await ResearcherModel.findById(id).select('email emailPrefs closedAt');
  if (!r || r.closedAt) return null;
  if (kind && r.emailPrefs && r.emailPrefs[kind] === false) return null;
  return r.email as string;
}
