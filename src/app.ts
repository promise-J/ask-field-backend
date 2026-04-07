import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import routes from './routes';
import { errorMiddleware } from './middlewares/error.middleware';
import { rateLimiter } from './middlewares/rateLimiter.middleware';
import { requestLogger } from './middlewares/requestLogger.middleware';
import errorController from './error-helpers/error.controller';
import AppError from './error-helpers/appError';

import swaggerUi from 'swagger-ui-express';
import { swaggerDocument } from './config/swagger/swagger';


const app = express();

app.use(helmet());
app.use(cors());

app.use(requestLogger);
app.use(express.json());

app.use(morgan('dev'));
app.use(rateLimiter);

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.use('/api', routes);

app.get("/", async(req, res) => {
  res.send("This is the base project");
});


app.all("*", (req, res, next) => {
    next(
      new AppError(
        `Can’t find ${req.originalUrl} with ${req.method} method on this server`,
        501
      )
    );
  });
  
  app.use(errorController);

app.use(errorMiddleware);

export default app;
