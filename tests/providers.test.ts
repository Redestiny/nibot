import { afterEach, describe, expect, it } from 'vitest';

import {
  addProviderToStore,
  maskApiKey,
  parseProviderStore,
  resolveProvider,
  setDefaultProviderInStore,
} from '../src/providers.js';

describe('providers', () => {
  it('adds providers and defaults the first one', () => {
    const store = addProviderToStore(
      { providers: [] },
      {
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
          name: 'deepseek',
          base_url: 'https://api.deepseek.com/v1',
          api_key: 'sk-test-123456',
          model: 'deepseek-chat',
        },
        {
          name: 'claude',
          base_url: 'https://proxy.example/v1',
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
              name: 'deepseek',
              base_url: 'https://api.deepseek.com/v1',
              api_key: 'sk-test-123456',
              model: 'deepseek-chat',
            },
          ],
          default_provider: 'deepseek',
        },
        {
          name: 'deepseek',
          base_url: 'https://api.deepseek.com/v1',
          api_key: 'sk-test-duplicate',
          model: 'deepseek-chat',
        },
      ),
    ).toThrow('Provider "deepseek" already exists');
  });
});
