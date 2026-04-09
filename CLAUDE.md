# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在本代码仓库中工作时提供指导。

## 构建和测试命令

```bash
npm run build   # 编译 TypeScript 到 dist/
npm run dev     # 直接用 tsx 运行 CLI（无需编译）
npm test        # 运行 vitest 单元测试
```

## 项目概述

Nibot 是一个用于 AI 辅助小说写作的 CLI 工具。它为每本书维护三个"本源"文件（outline、world_state、characters）来引导 AI 的创作，避免情节不一致和卡文问题。

## 架构

### 模块结构

- **`src/core/`** - 纯业务逻辑，无 I/O 依赖
  - `app.ts` - 编排所有操作（createBook、writeChapter、completeChapter、prepareSync 等），async 函数
  - `workspace.ts` - 书籍目录结构和文件 I/O（章节、设定）
  - `providers.ts` - Provider 存储（全局配置，位于 `~/.config/nibot/config.json` 或 `XDG_CONFIG_HOME/nibot/config.json`）
  - `prompts.ts` - 为 write/complete/sync 操作构建聊天消息
  - `sync.ts` - 解析 sync JSON 响应并生成 diff

- **`src/core/llm/`** - LLM 客户端（工厂模式 + 抽象基类）
  - `base.ts` - `LlmClientBase` 抽象基类，定义模板方法
  - `openai.ts` - `OpenAiClient`，使用 OpenAI SDK
  - `anthropic.ts` - `AnthropicClient`，使用 Anthropic SDK
  - `llm_wrapper.ts` - `LLMClient` 工厂类，根据 `provider.type` 路由

- **`src/cli/`** - CLI 接口层
  - `program.ts` - Commander.js 命令树和 runCli 入口
  - `interactions.ts` - 交互式提示（provider 输入、确认）
  - `renderers.ts` - 人类可读的输出格式化
  - `output.ts` - 双输出写入器（人类可读 vs JSON 模式）

### 数据流

1. CLI 解析命令 → 调用 App 方法
2. App 协调 workspace 文件 + LLM 客户端 + prompts
3. LLM 响应实时流式输出到 stdout，同时收集用于文件写入
4. Sync 命令生成 diff，需要用户确认后才应用

### 书籍 Workspace 结构

每本书位于运行 `nibot` 的工作目录下的子目录中：

```
book-id/
  book.json           # 元数据 (id, title, lang, created_at)
  .env                # 书籍级环境变量（如 NIBOT_CONTEXT_PREV_CHAPTERS=3）
  settings/
    outline.md        # 故事大纲
    world_state.md    # 世界背景和重大事件
    characters.md     # 角色设定和关系
  chapters/
    0001.md           # 章节文件（4 位补零）
    0002.md
    ...
```

### Provider 配置

Provider 存储在全局（不是每本书独立），支持任意 OpenAI 兼容 API 端点。配置位置遵循 XDG 规范：
- 若设置了 `XDG_CONFIG_HOME`，则为 `$XDG_CONFIG_HOME/nibot/config.json`
- 否则为 `~/.config/nibot/config.json`

### 关键设计决策

- **LLM 客户端架构** - 工厂模式 + 抽象基类
  - `LlmClientBase` 抽象基类定义模板方法
  - `OpenAiClient` / `AnthropicClient` 继承基类实现差异逻辑
  - `LLMClient` 工厂类根据 `provider.type` 路由
- **Provider 在构造时绑定** - `createNibotApp` 是 async，LLMClient 在首次需要时延迟创建
- **流式输出** - 章节内容实时流式输出到 stdout，同时收集用于文件写入
- **Sync 基于 diff** - LLM 返回新的 world_state/characters 内容；展示给用户确认后才应用
- **每本书独立的 .env** - 控制上下文窗口（包含的前序章节数量）
