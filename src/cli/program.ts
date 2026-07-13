import { stdin, stdout, stderr } from 'node:process';
import { Command, CommanderError, InvalidArgumentError } from 'commander';

import { createNibotApp } from '../core/app.js';
import { NibotError, toNibotError } from '../core/errors.js';
import type { LlmClient } from '../core/types.js';
import { parseChapterNumber } from '../core/workspace.js';
import { confirmAction, promptForProvider, type CliStreams } from './interactions.js';
import { OutputWriter } from './output.js';
import {
  renderBookCreatedMessage,
  renderBookListMessage,
  renderBookStatusMessage,
  renderProviderListMessage,
  renderWriteResultMessage,
} from './renderers.js';

export interface BuildCliOptions {
  cwd?: string;
  homeDir?: string;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  llmClient?: LlmClient;
  now?: () => Date;
}

export async function buildProgram(options: BuildCliOptions = {}): Promise<Command> {
  const io: CliStreams = {
    stdin: options.stdin ?? stdin,
    stdout: options.stdout ?? stdout,
    stderr: options.stderr ?? stderr,
  };
  const app = await createNibotApp({
    cwd: options.cwd ?? process.cwd(),
    homeDir: options.homeDir,
    llmClient: options.llmClient,
    now: options.now,
  });

  const program = new Command();
  program
    .name('nibot')
    .description('Nibot CLI MVP')
    .showHelpAfterError();

  const book = program.command('book').description('Manage books');

  book
    .command('create')
    .argument('<bookid>', 'Book id')
    .option('--json', 'Output structured JSON')
    .action(async (bookId: string, commandOptions: { json?: boolean }) => {
      const output = new OutputWriter(io, Boolean(commandOptions.json));
      const result = await app.createBook(bookId);

      if (commandOptions.json) {
        output.json(result);
        return;
      }

      output.info(renderBookCreatedMessage(result));
    });

  book
    .command('list')
    .option('--json', 'Output structured JSON')
    .action(async (commandOptions: { json?: boolean }) => {
      const output = new OutputWriter(io, Boolean(commandOptions.json));
      const result = await app.listBooks();

      if (commandOptions.json) {
        output.json({ books: result });
        return;
      }

      output.info(renderBookListMessage(result));
    });

  program
    .command('status')
    .argument('<bookid>', 'Book id')
    .option('--json', 'Output structured JSON')
    .action(async (bookId: string, commandOptions: { json?: boolean }) => {
      const output = new OutputWriter(io, Boolean(commandOptions.json));
      const result = await app.getBookStatus(bookId);

      if (commandOptions.json) {
        output.json({ book: result });
        return;
      }

      output.info(renderBookStatusMessage(result));
    });

  program
    .command('write')
    .argument('<bookid>', 'Book id')
    .option('--chapter <number>', 'Target chapter number', parseChapterOption)
    .option('--intent <text>', 'Author intent')
    .option('--provider <name>', 'Provider override')
    .option('--json', 'Output structured JSON')
    .action(
      async (
        bookId: string,
        commandOptions: {
          chapter?: number;
          intent?: string;
          provider?: string;
          json?: boolean;
        },
      ) => {
        const output = new OutputWriter(io, Boolean(commandOptions.json));
        let streamed = '';
        const result = await app.writeChapter({
          bookId,
          chapter: commandOptions.chapter,
          intent: commandOptions.intent,
          providerName: commandOptions.provider,
          onText: (chunk) => {
            streamed += chunk;
            output.stream(chunk);
          },
        });

        output.finishStream(streamed);

        if (commandOptions.json) {
          output.json(result);
          return;
        }

        output.info(renderWriteResultMessage(result));
        output.info(`Run "nibot sync ${bookId}" to review settings updates.`);
      },
    );

  program
    .command('complete')
    .argument('<bookid>', 'Book id')
    .option('--chapter <number>', 'Target chapter number', parseChapterOption)
    .option('--intent <text>', 'Author intent')
    .option('--provider <name>', 'Provider override')
    .option('--json', 'Output structured JSON')
    .action(
      async (
        bookId: string,
        commandOptions: {
          chapter?: number;
          intent?: string;
          provider?: string;
          json?: boolean;
        },
      ) => {
        const output = new OutputWriter(io, Boolean(commandOptions.json));
        let streamed = '';
        const result = await app.completeChapter({
          bookId,
          chapter: commandOptions.chapter,
          intent: commandOptions.intent,
          providerName: commandOptions.provider,
          onText: (chunk) => {
            streamed += chunk;
            output.stream(chunk);
          },
        });

        output.finishStream(streamed);

        if (commandOptions.json) {
          output.json(result);
          return;
        }

        output.info(renderWriteResultMessage(result));
        output.info(`Run "nibot sync ${bookId}" to review settings updates.`);
      },
    );

  program
    .command('sync')
    .argument('<bookid>', 'Book id')
    .option('--provider <name>', 'Provider override')
    .option('--yes', 'Apply settings changes without asking for confirmation')
    .option('--json', 'Output structured JSON')
    .action(
      async (
        bookId: string,
        commandOptions: {
          provider?: string;
          yes?: boolean;
          json?: boolean;
        },
      ) => {
        const output = new OutputWriter(io, Boolean(commandOptions.json));
        const prepared = await app.prepareSync({
          bookId,
          providerName: commandOptions.provider,
        });

        output.info(prepared.diff.trimEnd());

        if (prepared.changed_files.length === 0) {
          const payload = {
            ...prepared,
            applied: false,
            reason: 'no_changes',
          };

          if (commandOptions.json) {
            output.json(payload);
            return;
          }

          output.info('No settings changes to apply.');
          return;
        }

        const confirmed =
          commandOptions.yes ||
          (await confirmAction(
            io,
            Boolean(commandOptions.json),
            'Apply these settings changes? [y/N] ',
          ));

        if (!confirmed) {
          if (commandOptions.json) {
            output.json({
              ...prepared,
              applied: false,
              reason: 'rejected',
            });
            return;
          }

          output.info('Sync cancelled. Settings were not changed.');
          return;
        }

        const applied = await app.applySync(bookId, prepared.update);

        if (commandOptions.json) {
          output.json({
            ...prepared,
            ...applied,
            applied: true,
          });
          return;
        }

        output.info(`Updated ${applied.updated_files.join(', ')}.`);
      },
    );

  program
    .command('gui')
    .description('Start the local web GUI server')
    .option('--port <number>', 'Port to listen on', parsePortOption, 4317)
    .option('--dir <path>', 'Books root directory (defaults to the current directory)')
    .option('--open', 'Open the GUI in the default browser')
    .action(async (commandOptions: { port: number; dir?: string; open?: boolean }) => {
      const output = new OutputWriter(io, false);
      const { startServer } = await import('../server/index.js');
      const { url } = await startServer({
        cwd: commandOptions.dir ?? options.cwd ?? process.cwd(),
        homeDir: options.homeDir,
        llmClient: options.llmClient,
        now: options.now,
        port: commandOptions.port,
      });

      output.info(`Nibot GUI listening on ${url} (Ctrl+C to stop)`);

      if (commandOptions.open) {
        const { spawn } = await import('node:child_process');
        const opener =
          process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        spawn(opener, [url], { stdio: 'ignore', detached: true }).unref();
      }
    });

  const provider = program.command('provider').description('Manage providers');

  provider
    .command('add')
    .option('--json', 'Output structured JSON')
    .action(async (commandOptions: { json?: boolean }) => {
      const jsonMode = Boolean(commandOptions.json);
      const output = new OutputWriter(io, jsonMode);
      const providerInput = await promptForProvider(io, jsonMode);
      const result = await app.addProvider(providerInput);

      if (jsonMode) {
        output.json(result);
        return;
      }

      output.info(`Added provider "${result.provider.name}".`);
      if (result.default_provider === result.provider.name) {
        output.info(`"${result.provider.name}" is now the default provider.`);
      }
    });

  provider
    .command('list')
    .option('--json', 'Output structured JSON')
    .action(async (commandOptions: { json?: boolean }) => {
      const output = new OutputWriter(io, Boolean(commandOptions.json));
      const result = await app.listProviders();

      if (commandOptions.json) {
        output.json(result);
        return;
      }

      output.info(renderProviderListMessage(result));
    });

  provider
    .command('set-default')
    .argument('<name>', 'Provider name')
    .option('--json', 'Output structured JSON')
    .action(async (name: string, commandOptions: { json?: boolean }) => {
      const output = new OutputWriter(io, Boolean(commandOptions.json));
      const result = await app.setDefaultProvider(name);

      if (commandOptions.json) {
        output.json(result);
        return;
      }

      output.info(`Default provider set to "${result.default_provider}".`);
    });

  return program;
}

export async function runCli(argv = process.argv, options: BuildCliOptions = {}): Promise<number> {
  const io = {
    stdout: options.stdout ?? stdout,
    stderr: options.stderr ?? stderr,
  };

  const program = await buildProgram(options);
  program.exitOverride();

  try {
    await program.parseAsync(argv);
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code !== 'commander.helpDisplayed') {
        io.stderr.write(`${error.message}\n`);
      }
      return error.exitCode;
    }

    const nibotError = toNibotError(error);
    io.stderr.write(`${nibotError.message}\n`);
    return nibotError.exitCode;
  }
}

function parseChapterOption(value: string): number {
  try {
    return parseChapterNumber(value);
  } catch (error) {
    if (error instanceof NibotError) {
      throw new InvalidArgumentError(error.message);
    }

    throw error;
  }
}

function parsePortOption(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new InvalidArgumentError('Port must be an integer between 1 and 65535.');
  }
  return port;
}
