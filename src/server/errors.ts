import { toNibotError } from '../core/errors.js';
import type { BridgeError } from '../shared/bridge.js';

type ErrorStatus = 400 | 404 | 409 | 500;

export function statusForErrorCode(code: string): ErrorStatus {
  if (code.endsWith('_NOT_FOUND')) {
    return 404;
  }

  if (code.endsWith('_ALREADY_EXISTS')) {
    return 409;
  }

  if (code.startsWith('INVALID_') || code.startsWith('NO_') || code === 'ABORTED') {
    return 400;
  }

  return 500;
}

export function toBridgeError(error: unknown): { status: ErrorStatus; error: BridgeError } {
  const nibotError = toNibotError(error);
  return {
    status: statusForErrorCode(nibotError.code),
    error: {
      code: nibotError.code,
      message: nibotError.message,
    },
  };
}
