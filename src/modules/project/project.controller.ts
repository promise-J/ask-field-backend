import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { apiSuccessResponse } from '../../utils/apiResponse';
import { ProjectService } from './project.service';

const service = new ProjectService();

export const listProjects = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.list(req.user!.id, Number(req.query.page), Number(req.query.limit));
  apiSuccessResponse(res, 'Projects fetched.', data);
});

export const createProject = asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'Project created.', await service.create(req.user!.id, req.body), 201);
});

export const getProject = asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'Project fetched.', await service.getOwned(req.user!.id, req.params.id));
});

export const renameProject = asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'Project renamed.', await service.rename(req.user!.id, req.params.id, req.body.title));
});

export const pinProject = asyncHandler(async (req: Request, res: Response) => {
  const project = await service.togglePin(req.user!.id, req.params.id);
  apiSuccessResponse(res, project.pinned ? 'Project pinned.' : 'Project unpinned.', project);
});

export const deleteProject = asyncHandler(async (req: Request, res: Response) => {
  await service.remove(req.user!.id, req.params.id);
  apiSuccessResponse(res, 'Project deleted.', null);
});
