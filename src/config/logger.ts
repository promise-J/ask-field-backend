import pino from 'pino';

const logger = pino({
  level: process.env.NODE_ENV === 'test' ? 'silent' : process.env.NODE_ENV === 'production' ? 'info' : 'debug',
});

export default logger;
