const winston = require("winston");
const path = require("path");
const fs = require("fs");

const logDirectory = path.join(process.cwd(), "logs");
try {
    fs.mkdirSync(logDirectory, { recursive: true });
} catch (mkdirError) {
    console.error("Unable to create log directory", mkdirError);
}

const logger = winston.createLogger({
    level: "info",
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({
            filename: path.join(logDirectory, "error.log"),
            level: "error",
        }),
        new winston.transports.File({
            filename: path.join(logDirectory, "combined.log"),
        }),
    ],
});

// If not in production, log to console as well
if (process.env.NODE_ENV !== "production") {
    logger.add(
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            ),
        })
    );
}

module.exports = logger;
