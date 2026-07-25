import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  addProviderToStore,
  getProviderConfigPath,
  loadProviderStore,
  maskApiKey,
  parseProviderStore,
  removeProviderFromStore,
  resolveProvider,
  saveProviderStore,
  setDefaultProviderInStore,
  validateProviderConfig,
} from './providers.js';
import type { ProviderStore } from './types.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      const { rm } = await import('node:fs/promises');
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

describe('providers', () => {
  it('resolves provider config path under XDG_CONFIG_HOME when no homeDir is injected', () => {
    expect(getProviderConfigPath(undefined, '/tmp/xdg')).toBe('/tmp/xdg/nibot/config.json');
  });

  it('lets an injected homeDir win over XDG_CONFIG_HOME', () => {
    // CI runners set XDG_CONFIG_HOME globally; an explicitly injected homeDir
    // must stay isolated from it or parallel tests share one real config file.
    expect(getProviderConfigPath('/tmp/home', '/tmp/xdg')).toBe(
      '/tmp/home/.config/nibot/config.json',
    );
  });

  it('adds providers and defaults the first one', () => {
    const store = addProviderToStore(
      { providers: [] },
      {
        type: 'openai',
        name: 'deepseek',
        base_url: 'https://api.deepseek.com/v1',
        api_key: 'sk-test-123456',
        model: 'deepseek-chat',
      },
    );

    expect(store.default_provider).toBe('deepseek');
    expect(resolveProvider(store).name).toBe('deepseek');
  });

  it('sets default provider explicitly', () => {
    const store: ProviderStore = {
      providers: [
        {
          type: 'openai',
          name: 'deepseek',
          base_url: 'https://api.deepseek.com/v1',
          api_key: 'sk-test-123456',
          model: 'deepseek-chat',
        },
        {
          type: 'anthropic',
          name: 'claude',
          base_url: 'https://proxy.example',
          api_key: 'sk-test-abcdef',
          model: 'claude-sonnet',
        },
      ],
      default_provider: 'deepseek',
    };

    const next = setDefaultProviderInStore(store, 'claude');
    expect(resolveProvider(next).name).toBe('claude');
  });

  it('parses provider config JSON and masks api keys', () => {
    const store = parseProviderStore(
      JSON.stringify({
        providers: [
          {
            type: 'openai',
            name: 'deepseek',
            base_url: 'https://api.deepseek.com/v1',
            api_key: 'sk-test-123456',
            model: 'deepseek-chat',
          },
        ],
        default_provider: 'deepseek',
      }),
    );

    expect(store.providers).toHaveLength(1);
    expect(maskApiKey('sk-test-123456')).toBe('sk-t...3456');
  });

  it('rejects duplicate provider names', () => {
    expect(() =>
      addProviderToStore(
        {
          providers: [
            {
              type: 'openai',
              name: 'deepseek',
              base_url: 'https://api.deepseek.com/v1',
              api_key: 'sk-test-123456',
              model: 'deepseek-chat',
            },
          ],
          default_provider: 'deepseek',
        },
        {
          type: 'openai',
          name: 'deepseek',
          base_url: 'https://api.deepseek.com/v1',
          api_key: 'sk-test-duplicate',
          model: 'deepseek-chat',
        },
      ),
    ).toThrow('Provider "deepseek" already exists');
  });

  it('saves and loads provider config from the XDG path', async () => {
    const xdgConfigHome = join(await createTempDir(), 'custom-config');
    const store: ProviderStore = {
      providers: [
        {
          type: 'openai',
          name: 'deepseek',
          base_url: 'https://api.deepseek.com/v1',
          api_key: 'sk-test-123456',
          model: 'deepseek-chat',
        },
      ],
      default_provider: 'deepseek',
    };

    await saveProviderStore(store, undefined, xdgConfigHome);

    expect(await readFile(join(xdgConfigHome, 'nibot', 'config.json'), 'utf8')).toContain(
      '"default_provider": "deepseek"',
    );
    await expect(loadProviderStore(undefined, xdgConfigHome)).resolves.toEqual(store);
  });

  it('writes the config file readable by the owner only', async () => {
    const xdgConfigHome = join(await createTempDir(), 'custom-config');

    await saveProviderStore({ providers: [] }, undefined, xdgConfigHome);

    const { mode } = await stat(join(xdgConfigHome, 'nibot', 'config.json'));
    expect(mode & 0o777).toBe(0o600);
  });

  it('removes providers and clears the default only when the default is removed', () => {
    const store: ProviderStore = {
      providers: [
        {
          type: 'openai' as const,
          name: 'deepseek',
          base_url: 'https://api.deepseek.com/v1',
          api_key: 'sk-test-123456',
          model: 'deepseek-chat',
        },
        {
          type: 'anthropic' as const,
          name: 'claude',
          base_url: 'https://proxy.example',
          api_key: 'sk-test-abcdef',
          model: 'claude-sonnet',
        },
      ],
      default_provider: 'deepseek',
    };

    const withoutClaude = removeProviderFromStore(store, 'claude');
    expect(withoutClaude.providers.map((provider) => provider.name)).toEqual(['deepseek']);
    expect(withoutClaude.default_provider).toBe('deepseek');

    const withoutDefault = removeProviderFromStore(store, 'deepseek');
    expect(withoutDefault.providers.map((provider) => provider.name)).toEqual(['claude']);
    expect(withoutDefault.default_provider).toBeUndefined();

    expect(() => removeProviderFromStore(store, 'missing')).toThrow(
      'Provider "missing" does not exist.',
    );
  });

  it('accepts an optional positive integer max_tokens and rejects invalid values', () => {
    const base = {
      type: 'anthropic',
      name: 'claude',
      base_url: 'https://proxy.example',
      api_key: 'sk-test-abcdef',
      model: 'claude-sonnet',
    };

    expect(validateProviderConfig({ ...base, max_tokens: 16000 }).max_tokens).toBe(16000);
    expect(validateProviderConfig(base).max_tokens).toBeUndefined();
    expect(() => validateProviderConfig({ ...base, max_tokens: 0 })).toThrow(
      'Provider max_tokens must be a positive integer',
    );
    expect(() => validateProviderConfig({ ...base, max_tokens: '4096' })).toThrow(
      'Provider max_tokens must be a positive integer',
    );
  });
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'nibot-providers-'));
  tempDirs.push(dir);
  return dir;
}
