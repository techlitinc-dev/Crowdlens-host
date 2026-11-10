import { randomUUID } from "node:crypto";
import { redactValue } from "./redact.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogContext {
  request_id?: string;
  run_id?: string;
  activity_id?: string;
  workspace_id?: string;
  user_id?: string;
  [key: string]: unknown;
}

export interface Logger {
  child(context: LogContext): Logger;
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

class JsonLogger implements Logger {
  constructor(
    private readonly base: LogContext,
    private readonly minLevel: LogLevel,
    private readonly sink: (line: string) => void,
    private readonly service: string,
  ) {}

  child(context: LogContext): Logger {
    return new JsonLogger({ ...this.base, ...context }, this.minLevel, this.sink, this.service);
  }

  private log(level: LogLevel, message: string, context: LogContext = {}): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    const record = redactValue({
      ts: new Date().toISOString(),
      level,
      service: this.service,
      msg: message,
      ...this.base,
      ...context,
    });
    this.sink(JSON.stringify(record));
  }

  debug(message: string, context?: LogContext): void {
    this.log("debug", message, context);
  }
  info(message: string, context?: LogContext): void {
    this.log("info", message, context);
  }
  warn(message: string, context?: LogContext): void {
    this.log("warn", message, context);
  }
  error(message: string, context?: LogContext): void {
    this.log("error", message, context);
  }
}

export function createLogger(options: {
  service: string;
  minLevel?: LogLevel;
  sink?: (line: string) => void;
  context?: LogContext;
}): Logger {
  return new JsonLogger(
    options.context ?? {},
    options.minLevel ?? (process.env.APP_ENV === "production" ? "info" : "debug"),
    options.sink ?? ((line) => console.log(line)),
    options.service,
  );
}

export function newRequestId(): string {
  return randomUUID();
}
