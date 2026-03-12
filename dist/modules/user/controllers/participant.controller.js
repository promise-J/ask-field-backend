"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUser = exports.createUser = void 0;
const participant_service_1 = require("../services/participant.service");
const asyncHandler_1 = require("../../../utils/asyncHandler");
const apiResponse_1 = require("../../../utils/apiResponse");
const participantService = new participant_service_1.ParticipantService();
exports.createUser = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const user = await participantService.createUser(req.body);
    if (!user.success) {
        return (0, apiResponse_1.apiFailureResponse)(res, user.message);
    }
    (0, apiResponse_1.apiSuccessResponse)(res, 'User created', user, 201);
});
exports.getUser = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const user = await participantService.getUser(req.params.id);
    (0, apiResponse_1.apiSuccessResponse)(res, 'User Fetched', user);
});
