#!/usr/bin/env node

import { createInterface } from 'node:readline/promises';
import { stdin, stdout, stderr } from 'node:process';
import { homedir } from 'node:os';
import { Command, CommanderError, InvalidArgumentError } from 'commander';
import { pathToFileURL } from 'node:url';

import {
  createNibotApp,
  renderBookCreatedMessage,
  renderBookListMessage,
  renderBookStatusMessage,
  renderProviderListMessage,
  renderWriteResultMessage,
} from './app.js';
import { NibotError, toNibotError } from './errors.js';
import { OutputWriter } from './output.js';
import type { LlmClient, ProviderConfig } from './types.js';
import { parseChapterNumber } from './workspace.js';

interface BuildCliOptions {
  cwd?: string;
  homeDir?: string;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  llmClient?: LlmClient;
  now?: () => Date;
}

export function buildProgram(options: BuildCliOptions = {}): Command {
  const io = {
    stdin: options.stdin ?? stdin,
    stdout: options.stdout ?? stdout,
    stderr: options.stderr ?? stderr,
  };
  const app = createNibotApp({
    cwd: options.cwd ?? process.cwd(),
    homeDir: options.homeDir ?? homedir(),
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
    .option('--json', 'Output structured JSON')
    .action(
      async (
        bookId: string,
        commandOptions: {
          provider?: string;
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

        const confirmed = await confirmAction(
          io,
          Boolean(commandOptions.json),
          'Apply these settings changes? [y/N] ',
        );

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

  const program = buildProgram(options);
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

async function promptForProvider(
  io: {
    stdin: NodeJS.ReadableStream;
    stdout: NodeJS.WritableStream;
    stderr: NodeJS.WritableStream;
  },
  jsonMode: boolean,
): Promise<ProviderConfig> {
  const promptOutput = jsonMode ? io.stderr : io.stdout;
  const rl = createInterface({
    input: io.stdin,
    output: promptOutput,
  });

  try {
    const name = (await rl.question('Provider name: ')).trim();
    const baseUrl = (await rl.question('Base URL: ')).trim();
    const apiKey = (await rl.question('API key: ')).trim();
    const model = (await rl.question('Model: ')).trim();

    return {
      name,
      base_url: baseUrl,
      api_key: apiKey,
      model,
    };
  } finally {
    rl.close();
  }
}

async function confirmAction(
  io: {
    stdin: NodeJS.ReadableStream;
    stdout: NodeJS.WritableStream;
    stderr: NodeJS.WritableStream;
  },
  jsonMode: boolean,
  prompt: string,
): Promise<boolean> {
  const rl = createInterface({
    input: io.stdin,
    output: jsonMode ? io.stderr : io.stdout,
  });

  try {
    const answer = (await rl.question(prompt)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

const isEntrypoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  const exitCode = await runCli();
  process.exitCode = exitCode;
}
