import fs from 'fs';
import path from 'path';

export interface LogContext {
  component?: string;
  operation?: string;
  [key: string]: any;
}

export interface LogError {
  message: string;
  stack?: string;
  code?: string | number;
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'trace';

interface LogMessage {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext & { error?: LogError };
}

class Logger {
  private static instance: Logger;
  private debugStream!: fs.WriteStream;
  private fullDebugStream!: fs.WriteStream;
  private traceStream!: fs.WriteStream;

  private constructor() {
    // Создаем потоки для записи логов только если не в тестовом окружении
    if (process.env.NODE_ENV !== 'test') {
      this.debugStream = fs.createWriteStream('debug.log', { flags: 'a' });
      this.fullDebugStream = fs.createWriteStream('full-debug.log', { flags: 'a' });
      this.traceStream = fs.createWriteStream('full-trace.log', { flags: 'a' });
    }
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private formatMessage(message: LogMessage): string {
    const contextStr = message.context ? `\n${JSON.stringify(message.context, null, 2)}` : '';
    return `[${message.timestamp}] [${message.level.toUpperCase()}] ${message.message}${contextStr}\n`;
  }

  private log(level: LogLevel, message: string, context?: LogContext & { error?: LogError }): void {
    const logMessage: LogMessage = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
    };

    const formattedMessage = this.formatMessage(logMessage);

    // Always output logs in CI environment or development mode
    if (process.env.CI || process.env.NODE_ENV === 'development') {
      switch (level) {
        case 'debug':
          console.debug(formattedMessage);
          break;
        case 'info':
          console.info(formattedMessage);
          break;
        case 'warn':
          console.warn(formattedMessage);
          break;
        case 'error':
          console.error(formattedMessage);
          break;
        case 'trace':
          console.trace(formattedMessage);
          break;
      }
    }

    // Записываем в файлы только если не в тестовом окружении
    if (process.env.NODE_ENV !== 'test') {
      // Всегда пишем в полный лог
      this.fullDebugStream.write(formattedMessage);

      // Пишем в специфичные логи в зависимости от уровня
      if (level === 'debug') {
        this.debugStream.write(formattedMessage);
      }

      if (level === 'trace') {
        this.traceStream.write(formattedMessage);
      }
    }
  }

  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext & { error?: LogError }): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: LogContext & { error?: LogError }): void {
    this.log('error', message, context);
  }

  trace(message: string, context?: LogContext): void {
    this.log('trace', message, context);
  }

  close(): void {
    if (process.env.NODE_ENV !== 'test') {
      this.debugStream.end();
      this.fullDebugStream.end();
      this.traceStream.end();
    }
  }
}

export const logger = Logger.getInstance();
