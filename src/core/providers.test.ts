import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  addProviderToStore,
  getProviderConfigPath,
  loadProviderStore,
  maskApiKey,
  parseProviderStore,
  resolveProvider,
  saveProviderStore,
  setDefaultProviderInStore,
} from './providers.js';

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
  it('resolves provider config path under ~/.config by default', () => {
    const original = process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_CONFIG_HOME;
    try {
      expect(getProviderConfigPath('/tmp/home')).toBe('/tmp/home/.config/nibot/config.json');
    } finally {
      process.env.XDG_CONFIG_HOME = original;
    }
  });

  it('resolves provider config path under XDG_CONFIG_HOME when provided', () => {
    expect(getProviderConfigPath('/tmp/home', '/tmp/xdg')).toBe('/tmp/xdg/nibot/config.json');
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
    const store = {
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
    const homeDir = await createTempDir();
    const xdgConfigHome = join(homeDir, 'custom-config');
    const store = {
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

    await saveProviderStore(store, homeDir, xdgConfigHome);

    expect(await readFile(join(xdgConfigHome, 'nibot', 'config.json'), 'utf8')).toContain(
      '"default_provider": "deepseek"',
    );
    await expect(loadProviderStore(homeDir, xdgConfigHome)).resolves.toEqual(store);
  });
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'nibot-providers-'));
  tempDirs.push(dir);
  return dir;
}
