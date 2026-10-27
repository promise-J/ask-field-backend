import { ParticipantModel } from '../models/participant.model';

const SECRETS = '+password +verificationToken +verificationTokenExpires +otp +otpExpires +otpAttempts +resetToken +resetTokenExpires';

export class ParticipantRepository {
  model = ParticipantModel;

  create(data: any) {
    return ParticipantModel.create(data);
  }

  findByEmail(email: string, withSecrets = false) {
    const q = ParticipantModel.findOne({ email: email.toLowerCase().trim() });
    return withSecrets ? q.select(SECRETS) : q;
  }

  findById(id: string) {
    return ParticipantModel.findById(id);
  }
}
