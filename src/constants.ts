export const BOOK_META_FILENAME = 'book.json';
export const BOOK_ENV_FILENAME = '.env';
export const SETTINGS_DIRNAME = 'settings';
export const CHAPTERS_DIRNAME = 'chapters';
export const OUTLINE_FILENAME = 'outline.md';
export const WORLD_STATE_FILENAME = 'world_state.md';
export const CHARACTERS_FILENAME = 'characters.md';
export const DEFAULT_CONTEXT_PREV_CHAPTERS = 3;
export const MAX_CHAPTER_NUMBER = 9999;

export const SYSTEM_ROLE_PROMPT = [
  '你是小说作者的执笔枪手，不是剧情主导者。',
  '你必须严格遵循大纲和现有设定，不得擅自修改世界规则、角色核心动机或主线方向。',
  '你输出的内容必须是可直接写入章节文件的正文，不要附加解释、标题外说明、注释或元信息。',
  '如果作者意图与既有设定冲突，应优先服从作者当前意图，但尽量保持已有世界状态自洽。',
].join('\n');
