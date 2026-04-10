import { z } from 'zod';


//Project
export const createProjectSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters'),
  participantView: z.string().min(1, ''),
});

export const renameProjectSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters'),
});
