import { describe, expect, it } from 'vitest';

import {
  buildWriteMessages,
  buildCompleteMessages,
  buildSyncMessages,
  formatChapterNumber,
} from './prompts.js';
import type { LoadedChapter, LoadedSetting } from './types.js';

const makeSetting = (filename: string, content: string): LoadedSetting => ({
  filename,
  content,
});

const makeChapter = (filename: string, content: string): LoadedChapter => ({
  filename,
  content,
});

describe('formatChapterNumber', () => {
  it('pads single digit numbers', () => {
    expect(formatChapterNumber(1)).toBe('0001.md');
  });

  it('pads two digit numbers', () => {
    expect(formatChapterNumber(12)).toBe('0012.md');
  });

  it('does not pad four digit numbers', () => {
    expect(formatChapterNumber(9999)).toBe('9999.md');
  });
});

describe('buildWriteMessages', () => {
  it('includes system prompt and user message', () => {
    const messages = buildWriteMessages({
      chapterNumber: 1,
      settings: [],
      previousChapters: [],
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('目标章节：0001.md');
  });

  it('shows "暂无已有章节" for first chapter', () => {
    const messages = buildWriteMessages({
      chapterNumber: 1,
      settings: [],
      previousChapters: [],
    });

    expect(messages[1].content).toContain('暂无已有章节');
  });

  it('includes previous chapters in user message', () => {
    const messages = buildWriteMessages({
      chapterNumber: 2,
      settings: [],
      previousChapters: [makeChapter('0001.md', '第一章内容')],
    });

    expect(messages[1].content).toContain('### 0001.md');
    expect(messages[1].content).toContain('第一章内容');
  });

  it('includes intent when provided', () => {
    const messages = buildWriteMessages({
      chapterNumber: 1,
      settings: [],
      previousChapters: [],
      intent: '续写战斗场景',
    });

    expect(messages[1].content).toContain('作者意图：');
    expect(messages[1].content).toContain('续写战斗场景');
  });

  it('does not render intent when empty', () => {
    const messages = buildWriteMessages({
      chapterNumber: 1,
      settings: [],
      previousChapters: [],
      intent: '',
    });

    expect(messages[1].content).not.toContain('作者意图：');
  });

  it('includes settings content in system prompt', () => {
    const settings = [
      makeSetting('outline.md', '# 大纲'),
      makeSetting('world_state.md', '## 世界'),
    ];

    const messages = buildWriteMessages({
      chapterNumber: 1,
      settings,
      previousChapters: [],
    });

    expect(messages[0].content).toContain('## outline.md');
    expect(messages[0].content).toContain('# 大纲');
    expect(messages[0].content).toContain('## world_state.md');
  });
});

describe('buildCompleteMessages', () => {
  it('includes chapter filename and content in user message', () => {
    const messages = buildCompleteMessages({
      chapterNumber: 1,
      settings: [],
      chapter: makeChapter('0001.md', '原始内容'),
    });

    expect(messages[1].content).toContain('0001.md');
    expect(messages[1].content).toContain('原始内容');
  });

  it('does not render intent when empty', () => {
    const messages = buildCompleteMessages({
      chapterNumber: 1,
      settings: [],
      chapter: makeChapter('0001.md', '原始内容'),
      intent: '',
    });

    expect(messages[1].content).not.toContain('作者意图：');
  });

  it('renders intent when provided', () => {
    const messages = buildCompleteMessages({
      chapterNumber: 1,
      settings: [],
      chapter: makeChapter('0001.md', '原始内容'),
      intent: '加入对话',
    });

    expect(messages[1].content).toContain('作者意图：');
    expect(messages[1].content).toContain('加入对话');
  });
});

describe('buildSyncMessages', () => {
  it('includes worldState, characters, and latestChapter in user message', () => {
    const messages = buildSyncMessages({
      settings: [],
      latestChapter: makeChapter('0003.md', '最新章节内容'),
      worldState: '当前世界状态',
      characters: '当前角色状态',
    });

    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('设定同步任务');

    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('0003.md');
    expect(messages[1].content).toContain('最新章节内容');
    expect(messages[1].content).toContain('当前世界状态');
    expect(messages[1].content).toContain('当前角色状态');
  });
});
