export interface OutputStreams {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

export class OutputWriter {
  private readonly humanTarget: NodeJS.WritableStream;

  public constructor(
    private readonly streams: OutputStreams,
    private readonly jsonMode: boolean,
  ) {
    this.humanTarget = jsonMode ? streams.stderr : streams.stdout;
  }

  public info(message: string): void {
    this.humanTarget.write(this.withTrailingNewline(message));
  }

  public stream(chunk: string): void {
    this.humanTarget.write(chunk);
  }

  public finishStream(content: string): void {
    if (content.length > 0 && !content.endsWith('\n')) {
      this.humanTarget.write('\n');
    }
  }

  public json(payload: unknown): void {
    this.streams.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }

  public error(message: string): void {
    this.streams.stderr.write(this.withTrailingNewline(message));
  }

  private withTrailingNewline(message: string): string {
    return message.endsWith('\n') ? message : `${message}\n`;
  }
}
