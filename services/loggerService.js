const fs = require('fs');
const path = require('path');

// Log levels
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  VERBOSE: 3,
  DEBUG: 4,
};

const LOG_LEVEL_NAMES = {
  0: 'ERROR',
  1: 'WARN',
  2: 'INFO',
  3: 'VERBOSE',
  4: 'DEBUG',
};

// ANSI color codes for console output
const COLORS = {
  ERROR: '\x1b[31m', // Red
  WARN: '\x1b[33m', // Yellow
  INFO: '\x1b[36m', // Cyan
  VERBOSE: '\x1b[35m', // Magenta
  DEBUG: '\x1b[37m', // White
  RESET: '\x1b[0m', // Reset
};

class LoggerService {
  constructor() {
    this.logLevel =
      LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LOG_LEVELS.INFO;
    this.logFile = process.env.LOG_FILE || 'logs/app.log';
    this.enableConsole = process.env.NODE_ENV !== 'production';
    this.enableFile = true;

    // Ensure log directory exists
    this.ensureLogDirectory();

    // Initialize log rotation
    this.initLogRotation();
  }

  ensureLogDirectory() {
    const logDir = path.dirname(this.logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  initLogRotation() {
    // Rotate logs daily
    setInterval(
      () => {
        this.rotateLogFile();
      },
      24 * 60 * 60 * 1000
    ); // 24 hours
  }

  rotateLogFile() {
    try {
      if (!fs.existsSync(this.logFile)) return;

      const stats = fs.statSync(this.logFile);
      const fileSize = stats.size;
      const maxSize = 10 * 1024 * 1024; // 10MB

      if (fileSize > maxSize) {
        const timestamp = new Date().toISOString().split('T')[0];
        const rotatedFile = this.logFile.replace('.log', `_${timestamp}.log`);

        fs.renameSync(this.logFile, rotatedFile);

        // Compress old log file
        this.compressLogFile(rotatedFile);

        // Clean up old log files (keep last 30 days)
        this.cleanOldLogs();
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Log rotation failed:', error);
    }
  }

  compressLogFile() {
    // In a real implementation, you might use gzip compression
    // For now, we'll just keep the original file
  }

  cleanOldLogs() {
    try {
      const logDir = path.dirname(this.logFile);
      const files = fs.readdirSync(logDir);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30); // 30 days ago

      files.forEach((file) => {
        const filePath = path.join(logDir, file);
        const stats = fs.statSync(filePath);

        if (
          stats.mtime < cutoff &&
          file.endsWith('.log') &&
          file !== path.basename(this.logFile)
        ) {
          fs.unlinkSync(filePath);
        }
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Log cleanup failed:', error);
    }
  }

  formatMessage(level, message, metadata = {}) {
    const timestamp = new Date().toISOString();
    const levelName = LOG_LEVEL_NAMES[level];

    const logEntry = {
      timestamp,
      level: levelName,
      message,
      ...metadata,
    };

    return {
      json: JSON.stringify(logEntry),
      console: `${timestamp} [${levelName}] ${message}${metadata && Object.keys(metadata).length > 0 ? ` ${JSON.stringify(metadata)}` : ''}`,
    };
  }

  writeToFile(formattedMessage) {
    if (!this.enableFile) return;

    try {
      fs.appendFileSync(this.logFile, formattedMessage.json + '\n');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to write to log file:', error);
    }
  }

  writeToConsole(level, formattedMessage) {
    if (!this.enableConsole) return;

    const levelName = LOG_LEVEL_NAMES[level];
    const color = COLORS[levelName] || COLORS.RESET;
    const coloredMessage = `${color}${formattedMessage.console}${COLORS.RESET}`;

    switch (level) {
      case LOG_LEVELS.ERROR:
        // eslint-disable-next-line no-console
        console.error(coloredMessage);
        break;
      case LOG_LEVELS.WARN:
        // eslint-disable-next-line no-console
        console.warn(coloredMessage);
        break;
      default:
        // eslint-disable-next-line no-console
        console.log(coloredMessage);
    }
  }

  log(level, message, metadata = {}) {
    if (level > this.logLevel) return;

    const formattedMessage = this.formatMessage(level, message, metadata);

    this.writeToFile(formattedMessage);
    this.writeToConsole(level, formattedMessage);
  }

  // Public logging methods
  error(message, metadata = {}) {
    this.log(LOG_LEVELS.ERROR, message, metadata);
  }

  warn(message, metadata = {}) {
    this.log(LOG_LEVELS.WARN, message, metadata);
  }

  info(message, metadata = {}) {
    this.log(LOG_LEVELS.INFO, message, metadata);
  }

  verbose(message, metadata = {}) {
    this.log(LOG_LEVELS.VERBOSE, message, metadata);
  }

  debug(message, metadata = {}) {
    this.log(LOG_LEVELS.DEBUG, message, metadata);
  }

  // Security logging
  security(event, metadata = {}) {
    this.log(LOG_LEVELS.WARN, `SECURITY: ${event}`, {
      type: 'security',
      event,
      timestamp: new Date().toISOString(),
      ...metadata,
    });
  }

  // Audit logging
  audit(action, metadata = {}) {
    this.log(LOG_LEVELS.INFO, `AUDIT: ${action}`, {
      type: 'audit',
      action,
      timestamp: new Date().toISOString(),
      ...metadata,
    });
  }

  // Performance logging
  performance(operation, duration, metadata = {}) {
    this.log(
      LOG_LEVELS.VERBOSE,
      `PERFORMANCE: ${operation} took ${duration}ms`,
      {
        type: 'performance',
        operation,
        duration,
        timestamp: new Date().toISOString(),
        ...metadata,
      }
    );
  }

  // Database operation logging
  database(operation, collection, metadata = {}) {
    this.log(LOG_LEVELS.DEBUG, `DB: ${operation} on ${collection}`, {
      type: 'database',
      operation,
      collection,
      timestamp: new Date().toISOString(),
      ...metadata,
    });
  }

  // API request logging
  request(req, res, duration) {
    const metadata = {
      type: 'request',
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      userId: req.user?._id,
      organizationId: req.headers['x-organization-id'],
      timestamp: new Date().toISOString(),
    };

    const level = res.statusCode >= 400 ? LOG_LEVELS.WARN : LOG_LEVELS.INFO;
    this.log(
      level,
      `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`,
      metadata
    );
  }

  // Express middleware for request logging
  requestMiddleware() {
    return (req, res, next) => {
      const start = Date.now();

      // Override res.end to capture response
      const originalEnd = res.end;
      res.end = function (...args) {
        const duration = Date.now() - start;
        logger.request(req, res, duration);
        originalEnd.apply(this, args);
      };

      next();
    };
  }

  // Structured query logging
  query(query, params, duration, metadata = {}) {
    this.log(LOG_LEVELS.DEBUG, `QUERY: ${query}`, {
      type: 'query',
      query,
      params,
      duration,
      timestamp: new Date().toISOString(),
      ...metadata,
    });
  }
}

// Create singleton instance
const logger = new LoggerService();

// Export both class and instance
module.exports = logger;
module.exports.LoggerService = LoggerService;
module.exports.LOG_LEVELS = LOG_LEVELS;
