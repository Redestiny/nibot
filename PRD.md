# Nibot PRD - MVP

## 1. 产品定位

**作者是编剧，AI 是执笔枪手。**

作者掌控故事骨架（大纲、冲突、钩子埋点），AI 负责将意图转化为具体文字并维护世界状态一致性。

---

## 2. 最小工作区文件结构 （nibot就是一个维护该工作区的服务）

```
/bookid/
├── /settings/          # 设定库（所有 .md 文件均自动加载）
│   ├── outline.md      # 大纲（高优先级 context）
│   ├── world_state.md  # 世界状态
│   ├── characters.md   # 角色设定（含主角）
│   └── *.md            # 作者自定义设定文件
├── /chapters/          # 正文库
│   ├── 0001.md
│   ├── 0002.md
│   └── ...
├── .env                # LLM providers、加载上下章节数等环境变量
└── book.json           # 书籍元信息
```

**book.json：**
```json
{
  "id": "string",
  "title": "string",
  "created_at": "string",
  "lang": "zh"
}
```

---

## 3. LLM 配置

多 provider 支持，配置存在 `$XDG_CONFIG_HOME/nibot/config.json`，若未设置 `XDG_CONFIG_HOME` 则回退到 `~/.config/nibot/config.json`：

```json
{
  "providers": [
    {
      "name": "deepseek",
      "base_url": "https://api.deepseek.com/v1",
      "api_key": "sk-xxx",
      "model": "deepseek-chat"
    },
    {
      "name": "claude",
      "base_url": "https://your-proxy/v1",
      "api_key": "sk-xxx",
      "model": "claude-sonnet-4-5"
    }
  ],
  "default_provider": "deepseek"
}
```

命令支持 `--provider` 临时切换。

---

## 4. 核心功能（MVP）

### 4.1 书籍管理

| 命令 | 说明 |
|------|------|
| `nibot book create <bookid>` | 创建新书，生成目录结构和空白设定文件 |
| `nibot book list` | 列出所有书籍 |
| `nibot status <bookid>` | 显示书籍状态（章节数、最新章节） |

### 4.2 写作命令

| 命令 | 说明 |
|------|------|
| `nibot write <bookid> [--intent "..."] [--provider name]` | 写下一章，加载 settings + 前几章作为 context |
| `nibot complete <bookid> [--intent "..."] [--provider name]` | 补全当前章节，加载 settings + 当前章节已有内容作为 context |

### 4.3 设定同步

| 命令 | 说明 |
|------|------|
| `nibot sync <bookid>` | 读取最新章节，提取变化，输出 diff 供作者 Review，确认后覆写 settings |

### 4.4 Provider 管理

| 命令 | 说明 |
|------|------|
| `nibot provider add` | 交互式添加 provider |
| `nibot provider list` | 列出所有 provider |
| `nibot provider set-default <name>` | 设置默认 provider |

---

## 5. Agent 工作流

### write 流程
```
nibot write 触发
    ↓
加载 settings/*.md
（outline.md 置顶，其余按文件名排序）
    ↓
加载最近几章，（可在由加载上下章节数环境变量决定）
无上一章则跳过
    ↓
拼装 context，调用 LLM 流式生成
    ↓
实时打印到终端
    ↓
写入 chapters/000N.md
    ↓
提示：是否运行 sync 更新 settings
```

### complete 流程
```
nibot complete 触发
    ↓
加载 settings/*.md
（outline.md 置顶）
    ↓
加载当前章节已有内容（全量）
    ↓
拼装 context，调用 LLM 流式生成续写内容
    ↓
实时打印到终端
    ↓
追加写入当前章节文件
    ↓
提示：是否运行 sync 更新 settings
```

### sync 流程
```
nibot sync 触发
    ↓
读取最新章节全文
    ↓
调用 LLM 提取变化
（角色状态、世界事件、伏笔变动）
    ↓
输出 diff 到终端供作者 Review
    ↓
作者确认 → 覆写对应 md 文件
作者拒绝 → 保持原文件不变
```

---

## 6. Context 组装规则

```
System Prompt
├── AI 角色定义（执笔枪手，严格遵循大纲）
├── outline.md 全文（置顶）
└── 其余 settings/*.md（按文件名字母序）

User Prompt
├── 上一章结尾 / 当前章节已有内容
├── 作者意图（有则加入，无则省略）
└── 写作指令
```

---

## 7. 非功能要求

- 流式输出，实时打印到终端
- settings 文件变更前必须经过作者确认，AI 不自动覆写
- 章节文件命名自动递增（`0001.md` → `0002.md`）
- 所有命令支持 `--json` 输出结构化数据，为后续 Web UI 预留接口
- provider 配置中 api_key 存本地，不上传

---

## 8. 技术栈

- **运行时**：Node.js 24
- **CLI 框架**：Commander.js
- **AI SDK**：OpenAI Node SDK（base_url 可配置对接任意兼容接口）
- **存储**：本地文件系统
- **后续扩展**：引入 Next.js 做 Web UI

---

## 9. MVP 不包含

- Web UI / 编辑器
- 打包分发
- 审计 Agent
- 多模型路由（写作用 A 模型，sync 用 B 模型）
- 通知推送