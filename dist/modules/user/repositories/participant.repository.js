"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParticipantRepository = void 0;
const participant_model_1 = require("../models/participant.model");
class ParticipantRepository {
    create(data) {
        return participant_model_1.ParticipantModel.create(data);
    }
    findByEmail(email) {
        return participant_model_1.ParticipantModel.findOne({ email });
    }
    findById(id) {
        return participant_model_1.ParticipantModel.findById(id);
    }
}
exports.ParticipantRepository = ParticipantRepository;
