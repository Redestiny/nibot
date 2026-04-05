# Nibot
Nibot是一个小说写作辅助工具
通过agent补全与生成来让作者再也不会卡文

---

## 核心机制
通过维护outline、world_state和characters三个本源文件来约束引导agent的创作。
也可以自定义新的设定文档。
| 本源文件 | 定义域 |
| ------ | ------ |
| `outline.md` | 大纲，故事走向 |
| `world_state` | 世界状态，世界背景、大事件 |
| `characters` | 角色库，角色设定，关系 |

---

## 命令参考
### 书籍管理

| 命令 | 说明 |
|------|------|
| `nibot book create <bookid>` | 创建新书，生成目录结构和空白设定文件 |
| `nibot book list` | 列出所有书籍 |
| `nibot status <bookid>` | 显示书籍状态（章节数、最新章节） |

## 写作命令

| 命令 | 说明 |
|------|------|
| `nibot write <bookid> [--intent "..."] [--provider name]` | 写下一章，加载 settings + 前几章作为 context |
| `nibot complete <bookid> [--intent "..."] [--provider name]` | 补全当前章节，加载 settings + 当前章节已有内容作为 context |

## 设定同步

| 命令 | 说明 |
|------|------|
| `nibot sync <bookid>` | 读取最新章节，提取变化，输出 diff 供作者 Review，确认后覆写 settings |

## Provider 管理

| 命令 | 说明 |
|------|------|
| `nibot provider add` | 交互式添加 provider |
| `nibot provider list` | 列出所有 provider |
| `nibot provider set-default <name>` | 设置默认 provider |