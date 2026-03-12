"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResearcherService = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const researcher_repository_1 = require("../repositories/researcher.repository");
const researcherRepo = new researcher_repository_1.ResearcherRepository();
class ResearcherService {
    async createUser(data) {
        const exists = await researcherRepo.findByEmail(data.email);
        if (exists) {
            throw new Error('User already exists');
        }
        const hashedPassword = await bcrypt_1.default.hash(data.password, 10);
        return researcherRepo.create({
            ...data,
            password: hashedPassword,
        });
    }
    async getUser(id) {
        const user = await researcherRepo.findById(id);
        if (!user)
            throw new Error('User not found');
        return user;
    }
}
exports.ResearcherService = ResearcherService;
