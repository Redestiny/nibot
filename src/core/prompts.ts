import { SYSTEM_ROLE_PROMPT } from './constants.js';
import type { ChatMessage, LoadedChapter, LoadedSetting } from './types.js';

export function buildWriteMessages(input: {
  chapterNumber: number;
  settings: LoadedSetting[];
  previousChapters: LoadedChapter[];
  intent?: string;
}): ChatMessage[] {
  return [
    {
      role: 'system',
      content: buildSystemPrompt(input.settings),
    },
    {
      role: 'user',
      content: [
        `目标章节：${formatChapterNumber(input.chapterNumber)}`,
        '',
        renderPreviousChapters(input.previousChapters),
        renderIntent(input.intent),
        [
          '写作要求：',
          '1. 延续已有章节的叙事风格和世界状态。',
          '2. 输出完整的下一章正文，不要输出说明文字。',
          '3. 保持情节推进、角色行为和伏笔与设定一致。',
        ].join('\n'),
      ]
        .filter((section) => section.trim().length > 0)
        .join('\n\n'),
    },
  ];
}

export function buildCompleteMessages(input: {
  chapterNumber: number;
  settings: LoadedSetting[];
  chapter: LoadedChapter;
  intent?: string;
}): ChatMessage[] {
  return [
    {
      role: 'system',
      content: buildSystemPrompt(input.settings),
    },
    {
      role: 'user',
      content: [
        `目标章节：${formatChapterNumber(input.chapterNumber)}`,
        '',
        `当前章节全文（${input.chapter.filename}）：\n${input.chapter.content.trim()}`,
        renderIntent(input.intent),
        [
          '续写要求：',
          '1. 只输出应追加到当前章节末尾的正文内容。',
          '2. 不要重复已有内容，也不要重写前文。',
          '3. 保持叙事连贯、人物状态一致，并承接当前章节结尾。',
        ].join('\n'),
      ]
        .filter((section) => section.trim().length > 0)
        .join('\n\n'),
    },
  ];
}

export function buildSyncMessages(input: {
  settings: LoadedSetting[];
  latestChapter: LoadedChapter;
  worldState: string;
  characters: string;
}): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        SYSTEM_ROLE_PROMPT,
        '',
        '你正在执行设定同步任务。',
        '请根据最新章节内容更新 world_state 和 characters 两份设定文件。',
        '不要修改 outline 的意图，也不要返回除 JSON 以外的任何内容。',
        '返回格式必须是一个 JSON 对象，包含以下字段：',
        '{',
        '  "world_state": "string",',
        '  "characters": "string",',
        '  "summary": "string, optional"',
        '}',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        '当前设定全文：',
        renderSettings(input.settings),
        '',
        `当前 world_state.md：\n${input.worldState.trim()}`,
        '',
        `当前 characters.md：\n${input.characters.trim()}`,
        '',
        `最新章节（${input.latestChapter.filename}）：\n${input.latestChapter.content.trim()}`,
        '',
        '请提取最新章节带来的设定变化，只更新必要信息，保持文件格式自然可读。',
      ].join('\n'),
    },
  ];
}

export function formatChapterNumber(chapterNumber: number): string {
  return `${String(chapterNumber).padStart(4, '0')}.md`;
}

function buildSystemPrompt(settings: LoadedSetting[]): string {
  return [SYSTEM_ROLE_PROMPT, '', '以下是必须遵循的设定上下文：', renderSettings(settings)].join(
    '\n',
  );
}

function renderSettings(settings: LoadedSetting[]): string {
  return settings
    .map((setting) => `## ${setting.filename}\n${setting.content.trim()}`)
    .join('\n\n');
}

function renderPreviousChapters(previousChapters: LoadedChapter[]): string {
  if (previousChapters.length === 0) {
    return '暂无已有章节，这是本书的第一章。';
  }

  return previousChapters
    .map((chapter) => `### ${chapter.filename}\n${chapter.content.trim()}`)
    .join('\n\n');
}

function renderIntent(intent?: string): string {
  if (!intent || intent.trim().length === 0) {
    return '';
  }

  return `作者意图：\n${intent.trim()}`;
}
