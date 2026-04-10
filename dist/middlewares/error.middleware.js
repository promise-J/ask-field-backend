"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorMiddleware = errorMiddleware;
const config_1 = require("../config");
function errorMiddleware(err, req, res, _next) {
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({
        success: false,
        message: err.message || 'Internal Server Error',
        stack: config_1.env.NODE_ENV === 'production' ? undefined : err.stack,
    });
}
