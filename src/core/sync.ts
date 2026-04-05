import { createPatch } from 'diff';

import { CHARACTERS_FILENAME, WORLD_STATE_FILENAME } from './constants.js';
import { NibotError } from './errors.js';
import type { SyncUpdate } from './types.js';

export interface SyncDiffResult {
  diff: string;
  changed_files: string[];
}

export function parseSyncUpdate(raw: string): SyncUpdate {
  const normalized = extractJsonBlock(raw.trim());

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch (error) {
    throw new NibotError('Sync response is not valid JSON.', {
      code: 'INVALID_SYNC_RESPONSE',
      cause: error,
    });
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new NibotError('Sync response must be a JSON object.', {
      code: 'INVALID_SYNC_RESPONSE',
    });
  }

  const candidate = parsed as Record<string, unknown>;
  const worldState = readRequiredString(candidate.world_state, 'world_state');
  const characters = readRequiredString(candidate.characters, 'characters');
  const summary =
    candidate.summary === undefined ? undefined : readRequiredString(candidate.summary, 'summary');

  return {
    world_state: worldState,
    characters,
    summary,
  };
}

export function buildSyncDiff(current: SyncUpdate, next: SyncUpdate): SyncDiffResult {
  const patches: string[] = [];
  const changedFiles: string[] = [];

  if (current.world_state !== next.world_state) {
    patches.push(
      createPatch(
        `settings/${WORLD_STATE_FILENAME}`,
        ensureTrailingNewline(current.world_state),
        ensureTrailingNewline(next.world_state),
      ).trimEnd(),
    );
    changedFiles.push(`settings/${WORLD_STATE_FILENAME}`);
  }

  if (current.characters !== next.characters) {
    patches.push(
      createPatch(
        `settings/${CHARACTERS_FILENAME}`,
        ensureTrailingNewline(current.characters),
        ensureTrailingNewline(next.characters),
      ).trimEnd(),
    );
    changedFiles.push(`settings/${CHARACTERS_FILENAME}`);
  }

  return {
    diff: patches.length > 0 ? `${patches.join('\n\n')}\n` : 'No settings changes detected.\n',
    changed_files: changedFiles,
  };
}

function extractJsonBlock(raw: string): string {
  const fencedMatch = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/u);
  if (fencedMatch?.[1]) {
    return fencedMatch[1];
  }

  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1);
  }

  return raw;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

function readRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new NibotError(`Sync response field "${fieldName}" must be a string.`, {
      code: 'INVALID_SYNC_RESPONSE',
    });
  }

  return value;
}
