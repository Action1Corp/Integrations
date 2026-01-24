// logging/logger.js
import fs from 'node:fs';
import path from 'node:path';

function getTimestamp() {
  return new Date().toISOString();
}

function safeFilename(ts) {
  
  return ts.replace(/[:]/g, '-').replace(/[.]/g, '-');
}

export function createLogger(options = {}) {
  const levelFromEnv = process.env.LOG_LEVEL || options.level || 'info';
  const levels = ['debug', 'info', 'warn', 'error'];

  
  const logDir = path.resolve(process.cwd(), 'logs');


  const runTs = getTimestamp();
  const logFile = path.join(logDir, `run-${safeFilename(runTs)}.log`);

  
  fs.mkdirSync(logDir, { recursive: true });

  function shouldLog(messageLevel) {
    return levels.indexOf(messageLevel) >= levels.indexOf(levelFromEnv);
  }

  function formatMessage(level, msg) {
    const ts = getTimestamp();
    return `[${ts}] [${level.toUpperCase()}] ${msg}`;
  }

  function writeToFile(line) {
    
    fs.appendFileSync(logFile, line + '\n', { encoding: 'utf8' });
  }

  function log(level, consoleFn, msg) {
    if (!shouldLog(level)) return;

    const line = formatMessage(level, msg);

   
    consoleFn(line);

  
    writeToFile(line);
  }

  return {
    debug(msg) { log('debug', console.debug, msg); },
    info(msg) { log('info', console.info, msg); },
    warn(msg) { log('warn', console.warn, msg); },
    error(msg) { log('error', console.error, msg); },

   
    getLogFile() { return logFile; },
  };
}
