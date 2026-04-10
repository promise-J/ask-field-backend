"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiSuccessResponse = apiSuccessResponse;
exports.apiFailureResponse = apiFailureResponse;
exports.serviceResponse = serviceResponse;
function apiSuccessResponse(res, message = 'Success', data, statusCode = 200) {
    return res.status(statusCode).json({
        success: true,
        message,
        data,
    });
}
function apiFailureResponse(res, error = '', statusCode = 400) {
    return res.status(statusCode).json({
        success: false,
        error
    });
}
function serviceResponse(success, message, data = null) {
    return {
        success,
        message,
        data
    };
}
