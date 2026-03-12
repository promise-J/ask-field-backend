"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestLogger = requestLogger;
const logger_1 = __importDefault(require("../config/logger"));
function requestLogger(req, res, next) {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        const logPayload = {
            method: req.method,
            url: req.originalUrl,
            statusCode: res.statusCode,
            duration: `${duration}ms`,
            ip: req.ip,
        };
        if (res.statusCode >= 500) {
            logger_1.default.error(logPayload, 'HTTP request failed');
        }
        else if (res.statusCode >= 400) {
            logger_1.default.warn(logPayload, 'HTTP request warning');
        }
        else {
            logger_1.default.info(logPayload, 'HTTP request completed');
        }
    });
    next();
}
