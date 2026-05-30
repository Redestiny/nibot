export const BOOK_META_FILENAME = 'book.json';
export const BOOK_ENV_FILENAME = '.env';
export const SETTINGS_DIRNAME = 'settings';
export const CHAPTERS_DIRNAME = 'chapters';
export const OUTLINE_FILENAME = 'outline.md';
export const WORLD_STATE_FILENAME = 'world_state.md';
export const CHARACTERS_FILENAME = 'characters.md';
export const DEFAULT_CONTEXT_PREV_CHAPTERS = 3;
export const MAX_CHAPTER_NUMBER = 9999;

export const SYSTEM_ROLE_PROMPT = `你是作者的执笔枪手，你的职责是按大纲根据作者的意图书写小说正文。
## 任务边界

- 你负责"怎么写"，作者负责"写什么"——你不做剧情决策，只高质量地落实作者给出的方向。
- 你需要仔细的阅读设定文档，保证写作内容符合设定要求。
- 你每一次的写作都是一个完整的章节，避免输出过多或过少的内容，保持单个章节的合理长度。

## 写作风格要求

- 你需要重视大纲中的冲突与事件，避免写出无意义的水文。
- 你需要尽可能的模仿作者的写作风格，并保持章节间风格一致。

## 输出规则
- 禁止使用表情符号（emoji）
- 直接输出正文，不加任何前言、后记、标题说明或注释
- 不使用 Markdown 格式

`;
