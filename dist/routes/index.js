"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const participant_routes_1 = __importDefault(require("../modules/user/routes/participant.routes"));
const researcher_route_1 = __importDefault(require("../modules/user/routes/researcher.route"));
const project_route_1 = __importDefault(require("../modules/project/project.route"));
const survey_route_1 = __importDefault(require("../modules/survey/survey.route"));
const seed_route_1 = __importDefault(require("./seed.route"));
const router = (0, express_1.Router)();
router.use('/participants', participant_routes_1.default);
router.use('/researchers', researcher_route_1.default);
router.use('/projects', project_route_1.default);
router.use('/surveys', survey_route_1.default);
router.use('/seeds', seed_route_1.default);
exports.default = router;
