import { surveyPaths } from "../../modules/survey/survey.openapi";
import { participantPaths } from "../../modules/user/routes/openapi/participant.openapi";
import { researcherPaths } from "../../modules/user/routes/openapi/researcher.openapi";
import { allSwaggerSchema } from "./swaggerHelper";


export const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Ask Field',
    version: '1.0.0',
    description: 'API Documentation',
  },
  servers: [{ url: 'https://askfield-backend2.onrender.com/api' }],
  paths: {
    ...participantPaths,
    ...researcherPaths,
    ...surveyPaths,
    // add other modules here
  },
  components: {
    schemas: allSwaggerSchema,
  },
};