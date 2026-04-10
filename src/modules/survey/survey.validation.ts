import { z } from 'zod';


//Survey

export const createDraftSurveySchema = z.object({
  projectId: z.string().min(24, "User ID is required"),
})

export const createSurveySchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  projectId: z.string().min(1, "Project ID is required"),

  surveyType: z.string().nonempty("Survey type is required"),
  surveyName: z.string().nonempty("Survey name is required"),
  internalSurveyName: z.string().optional(),

  surveyDescription: z.string().nonempty("Survey description is required"),
  surveyLabel: z.string().nonempty("Survey label is required"),

  usableDevices: z.array(z.string()).default([]),

  surveyEquipment: z.string().optional(),
  status: z.string().optional(),
  contentWarning: z.string().optional(),
  surveyURL: z.string().url().optional(),

  toRecordId: z.string().optional(),
  handleSubmission: z.string().optional(),
  addToParticipantGroup: z.string().optional(),
  howToFindParticipant: z.string().optional(),

  numberOfParticipants: z.number().default(0),

  howToScreenParticipants: z.string().optional(),
  surveyDistribution: z.string().optional(),
  surveyCrendentials: z.string().optional(),

  totalSubmission: z.number().default(0),
  inputRejection: z.number().default(0),
  surveyDuration: z.number().default(0),
  surveyAmount: z.number().default(0),
});
