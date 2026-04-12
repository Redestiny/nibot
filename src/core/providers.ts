import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { NibotError } from './errors.js';
import type { ProviderConfig, ProviderStore, ProviderType } from './types.js';

const CONFIG_DIRNAME = 'nibot';
const CONFIG_FILENAME = 'config.json';

function resolveConfigBaseDir(
  homeDir = homedir(),
  xdgConfigHome = process.env.XDG_CONFIG_HOME,
): string {
  if (typeof xdgConfigHome === 'string' && xdgConfigHome.length > 0) {
    return xdgConfigHome;
  }

  return join(homeDir, '.config');
}

export function getProviderConfigPath(
  homeDir = homedir(),
  xdgConfigHome?: string,
): string {
  return join(resolveConfigBaseDir(homeDir, xdgConfigHome ?? process.env.XDG_CONFIG_HOME), CONFIG_DIRNAME, CONFIG_FILENAME);
}

export async function loadProviderStore(
  homeDir = homedir(),
  xdgConfigHome = process.env.XDG_CONFIG_HOME,
): Promise<ProviderStore> {
  const configPath = getProviderConfigPath(homeDir, xdgConfigHome);

  try {
    const raw = await readFile(configPath, 'utf8');
    return parseProviderStore(raw);
  } catch (error) {
    if (isMissingFileError(error)) {
      return { providers: [], default_provider: undefined };
    }

    throw new NibotError(`Failed to read provider config at ${configPath}.`, {
      code: 'PROVIDER_CONFIG_READ_ERROR',
      cause: error,
    });
  }
}

export async function saveProviderStore(
  store: ProviderStore,
  homeDir = homedir(),
  xdgConfigHome = process.env.XDG_CONFIG_HOME,
): Promise<void> {
  const configPath = getProviderConfigPath(homeDir, xdgConfigHome);
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

export function addProviderToStore(
  store: ProviderStore,
  provider: ProviderConfig,
): ProviderStore {
  validateProviderConfig(provider);

  if (store.providers.some((existing) => existing.name === provider.name)) {
    throw new NibotError(`Provider "${provider.name}" already exists.`, {
      code: 'PROVIDER_ALREADY_EXISTS',
    });
  }

  return {
    providers: [...store.providers, provider],
    default_provider: store.default_provider ?? provider.name,
  };
}

export function setDefaultProviderInStore(
  store: ProviderStore,
  providerName: string,
): ProviderStore {
  if (!store.providers.some((provider) => provider.name === providerName)) {
    throw new NibotError(`Provider "${providerName}" does not exist.`, {
      code: 'PROVIDER_NOT_FOUND',
    });
  }

  return {
    ...store,
    default_provider: providerName,
  };
}

export function resolveProvider(
  store: ProviderStore,
  overrideName?: string,
): ProviderConfig {
  if (store.providers.length === 0) {
    throw new NibotError(
      'No providers are configured. Run "nibot provider add" first.',
      { code: 'NO_PROVIDERS' },
    );
  }

  const targetName = overrideName ?? store.default_provider;

  if (!targetName) {
    throw new NibotError(
      'No default provider is configured. Run "nibot provider set-default <name>".',
      { code: 'NO_DEFAULT_PROVIDER' },
    );
  }

  const provider = store.providers.find((item) => item.name === targetName);

  if (!provider) {
    throw new NibotError(`Provider "${targetName}" does not exist.`, {
      code: 'PROVIDER_NOT_FOUND',
    });
  }

  return provider;
}

export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) {
    return '*'.repeat(apiKey.length);
  }

  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

export function parseProviderStore(raw: string): ProviderStore {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new NibotError('Provider config is not valid JSON.', {
      code: 'INVALID_PROVIDER_CONFIG',
      cause: error,
    });
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new NibotError('Provider config must be a JSON object.', {
      code: 'INVALID_PROVIDER_CONFIG',
    });
  }

  const candidate = parsed as Record<string, unknown>;
  const providers = candidate.providers;

  if (!Array.isArray(providers)) {
    throw new NibotError('Provider config must contain a "providers" array.', {
      code: 'INVALID_PROVIDER_CONFIG',
    });
  }

  const normalizedProviders = providers.map((item) => validateProviderConfig(item));
  const defaultProvider =
    typeof candidate.default_provider === 'string' && candidate.default_provider.length > 0
      ? candidate.default_provider
      : undefined;

  return {
    providers: normalizedProviders,
    default_provider: defaultProvider,
  };
}

export function validateProviderConfig(input: unknown): ProviderConfig {
  if (!input || typeof input !== 'object') {
    throw new NibotError('Provider definition must be an object.', {
      code: 'INVALID_PROVIDER_CONFIG',
    });
  }

  const candidate = input as Record<string, unknown>;

  // Handle legacy configs without type field (default to openai)
  let type: ProviderType = 'openai';
  if (typeof candidate.type === 'string' && candidate.type.length > 0) {
    if (candidate.type !== 'anthropic' && candidate.type !== 'openai') {
      throw new NibotError(`Provider type "${candidate.type}" must be "anthropic" or "openai".`, {
        code: 'INVALID_PROVIDER_CONFIG',
      });
    }
    type = candidate.type as ProviderType;
  }

  const provider: ProviderConfig = {
    type,
    name: readNonEmptyString(candidate.name, 'Provider name'),
    base_url: readNonEmptyString(candidate.base_url, 'Provider base_url'),
    api_key: readNonEmptyString(candidate.api_key, 'Provider api_key'),
    model: readNonEmptyString(candidate.model, 'Provider model'),
  };

  return provider;
}

function readNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new NibotError(`${fieldName} must be a non-empty string.`, {
      code: 'INVALID_PROVIDER_CONFIG',
    });
  }

  return value.trim();
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  );
}
