import { ParticipantModel } from '../models/participant.model';

export class ParticipantRepository {
  async create(data: any) {
    return await ParticipantModel.create(data);
  }

  async findByEmail(email: string) {
    return await ParticipantModel.findOne({ email });
  }

  async findById(id: string) {
    return await ParticipantModel.findById(id);
  }

  async findOne(query: any) {
    return await ParticipantModel.findOne(query);
  }
}
