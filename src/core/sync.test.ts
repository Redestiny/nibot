import { describe, expect, it } from 'vitest';

import { parseSyncUpdate, buildSyncDiff } from './sync.js';
import type { SyncUpdate } from './types.js';

describe('parseSyncUpdate', () => {
  it('parses clean JSON with all fields', () => {
    const result = parseSyncUpdate(
      JSON.stringify({
        world_state: '# World State\n\n内容',
        characters: '# Characters\n\n角色',
        summary: '更新了设定',
      }),
    );

    expect(result.world_state).toBe('# World State\n\n内容');
    expect(result.characters).toBe('# Characters\n\n角色');
    expect(result.summary).toBe('更新了设定');
  });

  it('parses JSON wrapped in ```json fenced block', () => {
    const raw = '```json\n{"world_state":"WS","characters":"CH","summary":"S"}\n```';
    const result = parseSyncUpdate(raw);
    expect(result.world_state).toBe('WS');
    expect(result.characters).toBe('CH');
    expect(result.summary).toBe('S');
  });

  it('parses JSON wrapped in ``` fenced block without json marker', () => {
    const raw = '```\n{"world_state":"WS","characters":"CH"}\n```';
    const result = parseSyncUpdate(raw);
    expect(result.world_state).toBe('WS');
    expect(result.characters).toBe('CH');
  });

  it('parses bare JSON without any code fence', () => {
    const raw = '{"world_state":"WS","characters":"CH"}';
    const result = parseSyncUpdate(raw);
    expect(result.world_state).toBe('WS');
    expect(result.characters).toBe('CH');
  });

  it('allows summary to be undefined', () => {
    const result = parseSyncUpdate('{"world_state":"WS","characters":"CH"}');
    expect(result.world_state).toBe('WS');
    expect(result.characters).toBe('CH');
    expect(result.summary).toBeUndefined();
  });

  it('throws when world_state field is missing', () => {
    expect(() => parseSyncUpdate('{"characters":"CH"}')).toThrow(
      'Sync response field "world_state" must be a string.',
    );
  });

  it('throws when world_state is not a string', () => {
    expect(() => parseSyncUpdate('{"world_state":123,"characters":"CH"}')).toThrow(
      'Sync response field "world_state" must be a string.',
    );
  });

  it('throws when response is not an object', () => {
    expect(() => parseSyncUpdate('"just a string"')).toThrow(
      'Sync response must be a JSON object.',
    );
  });

  it('throws when JSON is invalid', () => {
    expect(() => parseSyncUpdate('{not json}')).toThrow('Sync response is not valid JSON.');
  });
});

describe('buildSyncDiff', () => {
  it('produces two patches when both files change', () => {
    const current: SyncUpdate = {
      world_state: '旧世界',
      characters: '旧角色',
    };
    const next: SyncUpdate = {
      world_state: '新世界',
      characters: '新角色',
    };

    const result = buildSyncDiff(current, next);

    expect(result.changed_files).toEqual([
      'settings/world_state.md',
      'settings/characters.md',
    ]);
    expect(result.diff).toContain('settings/world_state.md');
    expect(result.diff).toContain('settings/characters.md');
  });

  it('produces one patch when only world_state changes', () => {
    const current: SyncUpdate = {
      world_state: '旧世界',
      characters: '相同角色',
    };
    const next: SyncUpdate = {
      world_state: '新世界',
      characters: '相同角色',
    };

    const result = buildSyncDiff(current, next);

    expect(result.changed_files).toEqual(['settings/world_state.md']);
    expect(result.diff).toContain('settings/world_state.md');
    expect(result.diff).not.toContain('characters.md');
  });

  it('returns no changes when both are identical', () => {
    const current: SyncUpdate = {
      world_state: '相同',
      characters: '相同',
    };
    const next: SyncUpdate = {
      world_state: '相同',
      characters: '相同',
    };

    const result = buildSyncDiff(current, next);

    expect(result.changed_files).toEqual([]);
    expect(result.diff).toBe('No settings changes detected.\n');
  });

  it('ensures trailing newline before diffing', () => {
    const current: SyncUpdate = {
      world_state: '无尾换行',
      characters: '有尾换行\n',
    };
    const next: SyncUpdate = {
      world_state: '无尾换行\n',
      characters: '有尾换行\n',
    };

    const result = buildSyncDiff(current, next);
    expect(result.changed_files).toEqual(['settings/world_state.md']);
  });
});
