import { isValidObjectId } from 'mongoose';
import AppError from '../../error-helpers/appError';
import { ProjectModel } from './project.model';
import { SurveyModel } from '../survey/survey.model';

export class ProjectService {
  async list(userId: string, page = 1, limit = 10) {
    page = Math.max(1, Math.floor(page) || 1);
    limit = Math.min(100, Math.max(1, Math.floor(limit) || 10));
    const filter = { userId };
    const [total, data] = await Promise.all([
      ProjectModel.countDocuments(filter),
      ProjectModel.find(filter)
        .sort({ pinned: -1, pinnedAt: -1, updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
    ]);
    return { data, pagination: { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) } };
  }

  create(userId: string, data: { title: string; participantView?: string }) {
    return ProjectModel.create({ ...data, userId });
  }

  /** Only the owner can see or change a project. Anyone else gets 404, so ids can't be probed. */
  async getOwned(userId: string, id: string) {
    if (!isValidObjectId(id)) throw new AppError('Project not found.', 404);
    const project = await ProjectModel.findOne({ _id: id, userId });
    if (!project) throw new AppError('Project not found.', 404);
    return project;
  }

  async rename(userId: string, id: string, title: string) {
    const project = await this.getOwned(userId, id);
    project.title = title;
    return project.save();
  }

  /** Toggles the pin. */
  async togglePin(userId: string, id: string) {
    const project = await this.getOwned(userId, id);
    project.pinned = !project.pinned;
    project.pinnedAt = project.pinned ? new Date() : null;
    return project.save();
  }

  async remove(userId: string, id: string) {
    const project = await this.getOwned(userId, id);
    const live = await SurveyModel.countDocuments({ projectId: project._id, status: 'published' });
    if (live > 0) throw new AppError('Close the live studies in this project before deleting it.', 409);
    await SurveyModel.deleteMany({ projectId: project._id, status: 'draft' });
    await project.deleteOne();
  }
}
