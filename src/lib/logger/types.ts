export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug: (obj?: LogFields, msg?: string) => void;
  info: (obj?: LogFields, msg?: string) => void;
  warn: (obj?: LogFields, msg?: string) => void;
  error: (obj?: LogFields, msg?: string) => void;
  child: (bindings?: LogFields) => Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  base?: LogFields;
}

