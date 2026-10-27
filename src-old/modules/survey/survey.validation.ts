import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Choose a project first.');
const num = z.coerce.number().finite().nonnegative();
const str = (max = 5000) => z.string().trim().max(max);

export const createDraftSurveySchema = z.object({
  projectId: objectId,
  surveyName: z.string().trim().min(1, 'Give your study a name.').max(160),
});

/** Stage 3: "Plan your …" on the dashboard, or "Start with these numbers" from the cost estimate. */
export const startStudySchema = z.object({
  method: z.enum(['survey', 'interview', 'focus-group', 'product-test', 'ai-evaluation'], { message: 'Choose what you want to run.' }),
  surveyName: z.string().trim().max(160).optional(),
  projectId: objectId.optional(),
  estimate: z
    .object({
      participants: z.number().int().min(1).max(100000),
      minutes: z.number().int().min(1).max(600),
      ratePerHour: z.number().min(0).max(10000),
    })
    .optional(),
});

export const planStepSchema = z.object({ data: z.record(z.string(), z.unknown()).default({}), final: z.boolean().default(false) });
export const screenSchema = z.object({ answers: z.array(z.number().int().min(0).max(20)).max(3) });
export const startLinkSchema = z.object({ consent: z.boolean().default(false) });

export const launchPaySchema = z.object({
  method: z.enum(['card', 'invoice']),
  useCredit: z.boolean().default(false),
  agree: z.boolean().default(false),
  receipt: z.object({
    name: z.string().trim().min(1, 'Add the name for the receipt.').max(160),
    organization: z.string().trim().max(200).default(''),
    email: z.string().trim().email('Enter a valid email for the receipt.'),
    cc: z.union([z.literal(''), z.string().trim().email('Enter a valid email to copy, or leave it empty.')]).default(''),
    reference: z.string().trim().max(120).default(''),
    country: z.string().trim().min(2, 'Choose a country.').max(80),
  }),
});

export const updateDraftSurveySchema = z
  .object({
    surveyType: z.enum(['external', 'aiTaskBuilder']),
    surveyName: z.string().trim().min(1, 'Give your study a name.').max(160),
    internalSurveyName: str(160),
    surveyDescription: str(),
    contentWarning: str(),
    surveyLabel: str(60),
    usableDevices: z.array(str(40)).max(10),
    surveyEquipment: str(500),
    minimumAge: num.max(120),
    maximumAge: num.max(120),
    gender: str(40),
    surveyURL: z.union([z.literal(''), z.string().trim().url('Enter a full study link, starting with https://')]),
    toRecordId: str(200),
    handleSubmission: str(200),
    addToParticipantGroup: str(200),
    howToFindParticipant: str(200),
    howToScreenParticipants: str(200),
    screenerIds: z.array(str(80)).max(50),
    surveyDistribution: str(200),
    surveyCrendentials: str(500),
    numberOfParticipants: num.int().max(100000),
    totalSubmission: num.int().max(100000),
    inputRejection: num.int().max(100000),
    surveyDuration: num.max(24 * 60),
    surveyAmount: num.max(10_000_000),
  })
  .partial()
  .refine((v) => v.minimumAge === undefined || v.maximumAge === undefined || v.minimumAge <= v.maximumAge, {
    message: 'Minimum age must be lower than maximum age.',
  });

export const createSurveyActionSchema = z.object({ surveyId: z.string().regex(/^[a-f\d]{24}$/i, 'This study could not be found.') });
