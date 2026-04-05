#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import { runCli } from './program.js';

export { buildProgram, runCli } from './program.js';

const isEntrypoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  const exitCode = await runCli();
  process.exitCode = exitCode;
}
