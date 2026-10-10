const winston = require('winston');
const path = require('path');
const fs = require('fs');

const logDirectory = path.join(process.cwd(), 'logs');
try {
  fs.mkdirSync(logDirectory, { recursive: true });
} catch (mkdirError) {
  console.error('Unable to create log directory', mkdirError);
}

/** One JSON object per line, keeping an Error's message and stack, which JSON alone drops. */
const jsonFormat = winston.format.combine(
  winston.format.errors({ stack: true }),
  winston.format.timestamp(),
  winston.format.json()
);

const logger = winston.createLogger({
  level: 'info',
  format: jsonFormat,
  transports: [
    new winston.transports.File({
      filename: path.join(logDirectory, 'error.log'),
      level: 'error',
    }),
    new winston.transports.File({
      filename: path.join(logDirectory, 'combined.log'),
    }),
  ],
});

// The console is the only log a host such as Railway shows; files inside the
// container are lost on every deploy. Production keeps JSON lines,
// development a readable coloured line.
logger.add(
  new winston.transports.Console({
    format: process.env.NODE_ENV === 'production'
      ? jsonFormat
      : winston.format.combine(winston.format.colorize(), winston.format.simple()),
  })
);

module.exports = logger;
