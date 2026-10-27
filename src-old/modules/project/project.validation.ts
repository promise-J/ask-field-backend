import { z } from 'zod';

export const createProjectSchema = z.object({
  title: z.string().trim().min(1, 'Give your project a name.').max(120, 'Keep the project name under 120 characters.'),
  participantView: z.string().trim().max(120).optional().default(''),
});

export const renameProjectSchema = z.object({
  title: z.string().trim().min(1, 'Give your project a name.').max(120, 'Keep the project name under 120 characters.'),
});
