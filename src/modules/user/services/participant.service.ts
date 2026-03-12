import { serviceResponse } from '../../../utils/apiResponse';
import { ParticipantRepository } from '../repositories/participant.repository';

const participantRepo = new ParticipantRepository();

export class ParticipantService {
  async createUser(data: any) {
    const exists = await participantRepo.findByEmail(data.email);
    if (exists) {
      return serviceResponse(false, 'User already exists')
    }

    const newUser = participantRepo.create(data);
    return serviceResponse(true, 'User created', newUser);
  }

  async getUser(id: string) {
    const user = await participantRepo.findById(id);
    if (!user) throw new Error('User not found');
    return user;
  }
}
