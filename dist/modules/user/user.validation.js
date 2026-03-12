"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createParticipantSchema = void 0;
const zod_1 = require("zod");
exports.createParticipantSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(6, 'Password must be at least 6 characters'),
    firstName: zod_1.z.string().nonempty('First name is required'),
    lastName: zod_1.z.string().min(5),
});
