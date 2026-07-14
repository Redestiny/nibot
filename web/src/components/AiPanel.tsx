import { useState } from 'react';

import { useGeneration } from '../api/generation';
import { useProviders } from '../api/queries';
import { useSessionStore } from '../stores/session';
import { IconStop } from './icons';
import { chapterLabel } from './labels';

export function AiPanel() {
  const [intent, setIntent] = useState('');
  const [provider, setProvider] = useState('');

  const providers = useProviders();
  const { run, stop } = useGeneration();
  const bookId = useSessionStore((state) => state.bookId);
  const openTarget = useSessionStore((state) => state.openTarget);
  const generation = useSessionStore((state) => state.generation);
  const openModal = useSessionStore((state) => state.openModal);

  const providerList = providers.data?.providers ?? [];
  const hasProviders = providerList.length > 0;
  const hasDefault = Boolean(providers.data?.default_provider);
  const providerReady = hasProviders && (hasDefault || provider.length > 0);

  const canWrite = Boolean(bookId) && !generation.running && providerReady;
  const canComplete = canWrite && openTarget?.kind === 'chapter';

  const generationInput = {
    intent,
    provider: provider.length > 0 ? provider : undefined,
  };

  return (
    <aside className="ai-panel">
      <div className="sidebar-heading">AI 辅助</div>

      <label className="field">
        <span className="field-label">作者意图（可选）</span>
        <textarea
          className="intent-input"
          value={intent}
          placeholder="例如：主角在废墟里发现线索，结尾埋一个伏笔。"
          rows={6}
          disabled={generation.running}
          onChange={(event) => setIntent(event.target.value)}
        />
      </label>

      <label className="field">
        <span className="field-label">Provider</span>
        <select
          value={provider}
          disabled={generation.running}
          onChange={(event) => setProvider(event.target.value)}
        >
          <option value="">
            {providers.data?.default_provider
              ? `默认（${providers.data.default_provider}）`
              : '默认（未设置）'}
          </option>
          {providerList.map((item) => (
            <option key={item.name} value={item.name}>
              {item.name}（{item.model}）
            </option>
          ))}
        </select>
      </label>

      {!hasProviders && !providers.isLoading ? (
        <div className="ai-warning">
          尚未配置任何 provider。
          <button type="button" className="btn-link" onClick={() => openModal('providers')}>
            去添加
          </button>
        </div>
      ) : null}

      {generation.running ? (
        <div className="ai-actions">
          <div className="ai-running">
            {generation.kind === 'write' ? 'AI 正在写' : 'AI 正在重写'}
            {generation.chapter !== null ? ` ${chapterLabel(generation.chapter)}` : ''}…
          </div>
          <button type="button" className="btn btn-danger" onClick={stop}>
            <IconStop size={12} /> 停止生成
          </button>
        </div>
      ) : (
        <div className="ai-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canWrite}
            title="按大纲与前文续写全新的下一章"
            onClick={() => void run('write', generationInput)}
          >
            AI 写新章
          </button>
          <button
            type="button"
            className="btn"
            disabled={!canComplete}
            title="以当前章节为底稿，让 AI 输出一个完整的重写稿（整章替换）"
            onClick={() => void run('complete', generationInput)}
          >
            AI 续写本章
          </button>
          <p className="ai-hint">
            续写会让 AI 参照当前章节输出完整的替换稿；生成过程中可随时停止，停止后文件保持原样。
          </p>
        </div>
      )}
    </aside>
  );
}
