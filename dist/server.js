"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = __importDefault(require("./app"));
const config_1 = require("./config");
async function bootstrap() {
    try {
        await (0, config_1.connectDB)();
        (0, config_1.connectRedis)();
        app_1.default.listen(config_1.env.PORT, () => {
            config_1.logger.info(`🚀 Server running on port ${config_1.env.PORT}`);
        });
    }
    catch (error) {
        config_1.logger.error({ error }, '❌ Failed to start server');
        process.exit(1);
    }
}
bootstrap();
