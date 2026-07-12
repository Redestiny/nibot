import type { SettingFilename } from '@shared/bridge';

import type { OpenTarget } from '../stores/session';

export const SETTING_LABELS: Record<SettingFilename, string> = {
  'outline.md': '大纲',
  'world_state.md': '世界状态',
  'characters.md': '角色',
};

export const SETTING_FILENAMES = Object.keys(SETTING_LABELS) as SettingFilename[];

export function chapterLabel(chapterNumber: number): string {
  return `第 ${chapterNumber} 章`;
}

export function targetLabel(target: OpenTarget): string {
  return target.kind === 'chapter'
    ? chapterLabel(target.number)
    : SETTING_LABELS[target.filename];
}
