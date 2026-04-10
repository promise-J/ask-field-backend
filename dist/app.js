"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const routes_1 = __importDefault(require("./routes"));
const error_middleware_1 = require("./middlewares/error.middleware");
const rateLimiter_middleware_1 = require("./middlewares/rateLimiter.middleware");
const requestLogger_middleware_1 = require("./middlewares/requestLogger.middleware");
const error_controller_1 = __importDefault(require("./error-helpers/error.controller"));
const appError_1 = __importDefault(require("./error-helpers/appError"));
const swagger_ui_express_1 = __importDefault(require("swagger-ui-express"));
const swagger_1 = require("./config/swagger/swagger");
const app = (0, express_1.default)();
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)());
app.use(requestLogger_middleware_1.requestLogger);
app.use(express_1.default.json());
app.use((0, morgan_1.default)('dev'));
app.use(rateLimiter_middleware_1.rateLimiter);
app.use('/api-docs', swagger_ui_express_1.default.serve, swagger_ui_express_1.default.setup(swagger_1.swaggerDocument));
app.use('/api', routes_1.default);
app.get("/", async (req, res) => {
    res.send("This is the base project");
});
app.all("*", (req, res, next) => {
    next(new appError_1.default(`Can’t find ${req.originalUrl} with ${req.method} method on this server`, 501));
});
app.use(error_controller_1.default);
app.use(error_middleware_1.errorMiddleware);
exports.default = app;
