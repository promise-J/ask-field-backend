"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParticipantService = void 0;
const apiResponse_1 = require("../../../utils/apiResponse");
const participant_repository_1 = require("../repositories/participant.repository");
const participantRepo = new participant_repository_1.ParticipantRepository();
class ParticipantService {
    async createUser(data) {
        const exists = await participantRepo.findByEmail(data.email);
        if (exists) {
            return (0, apiResponse_1.serviceResponse)(false, 'User already exists');
        }
        const newUser = participantRepo.create(data);
        return (0, apiResponse_1.serviceResponse)(true, 'User created', newUser);
    }
    async getUser(id) {
        const user = await participantRepo.findById(id);
        if (!user)
            throw new Error('User not found');
        return user;
    }
}
exports.ParticipantService = ParticipantService;
