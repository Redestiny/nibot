import { useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import type { ProviderInput, ProviderType } from '@shared/bridge';

import { useProviders } from '../api/queries';
import { getBridge } from '../bridge';
import { useSessionStore } from '../stores/session';
import { Modal } from './Modal';

const EMPTY_FORM = {
  type: 'openai' as ProviderType,
  name: '',
  base_url: '',
  api_key: '',
  model: '',
  max_tokens: '',
};

export function ProvidersModal() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const providers = useProviders();
  const closeModal = useSessionStore((state) => state.closeModal);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['providers'] });

  const runAction = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    }
  };

  const addProvider = async () => {
    if (pending) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const input: ProviderInput = {
        type: form.type,
        name: form.name.trim(),
        base_url: form.base_url.trim(),
        api_key: form.api_key.trim(),
        model: form.model.trim(),
      };
      if (form.max_tokens.trim().length > 0) {
        input.max_tokens = Number.parseInt(form.max_tokens, 10);
      }
      await getBridge().addProvider(input);
      await refresh();
      setForm(EMPTY_FORM);
      useSessionStore.getState().showToast(`Provider「${input.name}」已添加。`);
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : String(addError));
    } finally {
      setPending(false);
    }
  };

  const removeProvider = async (name: string) => {
    if (!window.confirm(`确定删除 provider「${name}」？`)) {
      return;
    }
    await runAction(() => getBridge().removeProvider(name));
  };

  const data = providers.data;

  return (
    <Modal title="Provider 设置" onClose={closeModal} wide>
      <div className="providers">
        {data && data.providers.length > 0 ? (
          <table className="providers-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>模型</th>
                <th>Base URL</th>
                <th>API Key</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.providers.map((provider) => (
                <tr key={provider.name} className="reveal-parent">
                  <td>
                    {provider.name}
                    {provider.is_default ? <span className="badge">默认</span> : null}
                  </td>
                  <td>{provider.model}</td>
                  <td className="providers-url">{provider.base_url}</td>
                  <td className="providers-key">{provider.api_key}</td>
                  <td className="providers-actions reveal-item">
                    {!provider.is_default ? (
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() =>
                          void runAction(() => getBridge().setDefaultProvider(provider.name))
                        }
                      >
                        设为默认
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn-link btn-link-danger"
                      onClick={() => void removeProvider(provider.name)}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="sidebar-empty">还没有配置 provider。</p>
        )}

        {data && data.providers.length > 0 && !data.default_provider ? (
          <p className="ai-warning">当前没有默认 provider，请设置一个，否则无法生成。</p>
        ) : null}

        <form
          className="form providers-form"
          onSubmit={(event) => {
            event.preventDefault();
            void addProvider();
          }}
        >
          <div className="sidebar-heading">添加 Provider</div>
          <div className="form-grid">
            <label className="field">
              <span className="field-label">类型</span>
              <select
                value={form.type}
                onChange={(event) =>
                  setForm({ ...form, type: event.target.value as ProviderType })
                }
              >
                <option value="openai">openai 兼容</option>
                <option value="anthropic">anthropic</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">名称</span>
              <input
                value={form.name}
                placeholder="deepseek"
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </label>
            <label className="field">
              <span className="field-label">Base URL</span>
              <input
                value={form.base_url}
                placeholder="https://api.deepseek.com/v1"
                onChange={(event) => setForm({ ...form, base_url: event.target.value })}
              />
            </label>
            <label className="field">
              <span className="field-label">API Key</span>
              <input
                type="password"
                value={form.api_key}
                placeholder="sk-…"
                onChange={(event) => setForm({ ...form, api_key: event.target.value })}
              />
            </label>
            <label className="field">
              <span className="field-label">模型</span>
              <input
                value={form.model}
                placeholder="deepseek-chat"
                onChange={(event) => setForm({ ...form, model: event.target.value })}
              />
            </label>
            <label className="field">
              <span className="field-label">max_tokens（可选）</span>
              <input
                value={form.max_tokens}
                placeholder="8192"
                inputMode="numeric"
                onChange={(event) => setForm({ ...form, max_tokens: event.target.value })}
              />
            </label>
          </div>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="form-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={
                pending ||
                form.name.trim().length === 0 ||
                form.base_url.trim().length === 0 ||
                form.api_key.trim().length === 0 ||
                form.model.trim().length === 0
              }
            >
              {pending ? '添加中…' : '添加'}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
