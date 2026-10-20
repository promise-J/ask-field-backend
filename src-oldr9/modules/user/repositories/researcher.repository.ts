import { ResearcherModel } from '../models/researcher.model';

const SECRETS = '+password +verificationToken +verificationTokenExpires +otp +otpExpires +otpAttempts +resetToken +resetTokenExpires';

export class ResearcherRepository {
  model = ResearcherModel;

  create(data: any) {
    return ResearcherModel.create(data);
  }

  findByEmail(email: string, withSecrets = false) {
    const q = ResearcherModel.findOne({ email: email.toLowerCase().trim() });
    return withSecrets ? q.select(SECRETS) : q;
  }

  findById(id: string) {
    return ResearcherModel.findById(id);
  }
}
