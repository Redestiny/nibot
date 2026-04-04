export class NibotError extends Error {
  public readonly code: string;
  public readonly exitCode: number;

  public constructor(
    message: string,
    options?: {
      code?: string;
      exitCode?: number;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'NibotError';
    this.code = options?.code ?? 'NIBOT_ERROR';
    this.exitCode = options?.exitCode ?? 1;
  }
}

export function toNibotError(error: unknown): NibotError {
  if (error instanceof NibotError) {
    return error;
  }

  if (error instanceof Error) {
    return new NibotError(error.message, { cause: error });
  }

  return new NibotError('An unknown error occurred.', { cause: error });
}
