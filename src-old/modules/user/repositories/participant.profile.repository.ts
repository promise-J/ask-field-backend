import ParticipantProfileModel from '../models/participant.profile.model';

export class ParticipantProfileRepository {
  async create(data: any) {
    return await ParticipantProfileModel.create(data);
  }

  async findByUserId(userId: string) {
    return await ParticipantProfileModel.findOne({ userId });
  }

  async findById(id: string) {
    return await ParticipantProfileModel.findById(id);
  }

  async findOne(query: any) {
    return await ParticipantProfileModel.findOne(query);
  }
}
