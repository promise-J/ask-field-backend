import { ResearcherModel } from '../models/researcher.model';

export class ResearcherRepository {
  async create(data: any) {
    return await ResearcherModel.create(data);
  }

  async findByEmail(email: string) {
    return await ResearcherModel.findOne({ email });
  }

  async findById(id: string) {
    return await ResearcherModel.findById(id);
  }
}
