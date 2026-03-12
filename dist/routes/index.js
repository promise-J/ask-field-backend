"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const participant_routes_1 = __importDefault(require("../modules/user/routes/participant.routes"));
const researcher_routes_1 = __importDefault(require("../modules/user/routes/researcher.routes"));
const router = (0, express_1.Router)();
router.use('/participants', participant_routes_1.default);
router.use('/researchers', researcher_routes_1.default);
exports.default = router;
