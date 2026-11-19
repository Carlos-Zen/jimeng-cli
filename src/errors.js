// Error types used by commands. Each carries a stable `code`, an optional `hint`, and an exit code.

export const EXIT_CODES = {
  OK: 0,
  GENERIC: 1,
  USAGE: 2,
  EMPTY: 66,
  AUTH: 77,
  BROWSER: 69,
  TIMEOUT: 75,
};

export class JimengError extends Error {
  constructor(message, hint, code = 'ERROR', exitCode = EXIT_CODES.GENERIC) {
    super(message);
    this.name = this.constructor.name;
    this.hint = hint;
    this.code = code;
    this.exitCode = exitCode;
  }
}

export class ArgumentError extends JimengError {
  constructor(message, hint) { super(message, hint, 'ARGUMENT', EXIT_CODES.USAGE); }
}

export class CommandExecutionError extends JimengError {
  constructor(message, hint) { super(message, hint, 'COMMAND_EXEC', EXIT_CODES.GENERIC); }
}

export class EmptyResultError extends JimengError {
  constructor(message, hint) { super(message || 'No results', hint, 'EMPTY_RESULT', EXIT_CODES.EMPTY); }
}

export class TimeoutError extends JimengError {
  /** (label, seconds, hint) — e.g. new TimeoutError('素材上传', 90, '…') → "素材上传 超时（90s）". */
  constructor(label, seconds, hint) {
    super(seconds != null ? `${label} 超时（${seconds}s）` : String(label), hint, 'TIMEOUT', EXIT_CODES.TIMEOUT);
  }
}

export class AuthRequiredError extends JimengError {
  /** Signature kept compatible with the old opencli error: (domain, message, hint). */
  constructor(domain, message, hint) {
    super(message || `Not logged in to ${domain}`, hint, 'AUTH_REQUIRED', EXIT_CODES.AUTH);
    this.domain = domain;
  }
}

export class BrowserConnectError extends JimengError {
  constructor(message, hint) { super(message, hint, 'BROWSER_CONNECT', EXIT_CODES.BROWSER); }
}
