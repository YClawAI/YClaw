import winston from 'winston';
import { join } from 'node:path';

// ─── Log Format Configuration ───────────────────────────────────────────────

const LOG_DIR = process.env.YCLAW_LOG_DIR || join(process.cwd(), 'logs');

const colorizedConsoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
  winston.format.printf(({ timestamp, level, message, agent, ...meta }) => {
    const agentTag = agent ? `[${agent}]` : '';
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} ${level} ${agentTag} ${message}${metaStr}`;
  }),
);

const structuredFileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json(),
);

// ─── Root Logger ────────────────────────────────────────────────────────────

const rootLogger = winston.createLogger({
  level: process.env.YCLAW_LOG_LEVEL || 'info',
  defaultMeta: { service: 'yclaw-protocol' },
  transports: [
    new winston.transports.Console({
      format: colorizedConsoleFormat,
    }),
    new winston.transports.File({
      filename: join(LOG_DIR, 'yclaw-error.log'),
      level: 'error',
      format: structuredFileFormat,
      maxsize: 10 * 1024 * 1024, // 10 MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: join(LOG_DIR, 'yclaw-combined.log'),
      format: structuredFileFormat,
      maxsize: 10 * 1024 * 1024,
      maxFiles: 10,
    }),
  ],
});

// ─── Child Logger Factory ───────────────────────────────────────────────────

/**
 * Creates a child logger scoped to a specific agent. The agent name is
 * automatically included in every log entry's metadata so structured queries
 * (e.g. in Kibana / Loki / CloudWatch) can filter by agent.
 */
export function createLogger(agentName: string): winston.Logger {
  return rootLogger.child({ agent: agentName });
}

export { rootLogger };
