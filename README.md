<p align="center">
  <img src="./assets/icon.svg" alt="Nibot icon" width="180" />
</p>

<h1 align="center">Intelligence at your nib<br><sub>笔尖智能助手</sub></h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@redestiny/nibot"><img src="https://img.shields.io/npm/v/@redestiny/nibot.svg?color=cb3837&logo=npm" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D24.0.0-brightgreen.svg" alt="Node.js"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-6.x-3178C6.svg?logo=typescript&logoColor=white" alt="TypeScript"></a>
</p>

# Nibot
Nibot是一个小说写作辅助工具
通过agent补全与生成来让作者再也不会卡文

---

## 快速开始

### 安装

```bash
npm i -g @redestiny/nibot
```

### 首次配置

```bash
nibot provider add    #开始交互式添加API提供商
```
配置保存在 `~/.config/nibot`，所有书籍项目共享此配置。

可在 `config.json` 中为 provider 添加可选的 `max_tokens` 字段，控制单次生成的最大输出 token 数（anthropic 类型默认 8192）。输出因达到上限被截断时会报错提示，不会静默写入半截内容。

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
| 命令 | 说明 |
|------|------|
| `nibot book create <bookid>` | 创建新书，生成工作目录与默认设定文件 |
| `nibot book list` | 列出所有书籍 |
| `nibot status <bookid>` | 显示书籍状态（章节数、最新章节） |
| `nibot write <bookid> [--chapter <number>]` | 生成下一章或指定章节内容 |
| `nibot complete <bookid> [--chapter <number>]` | 补全最新章节或指定章节 |
| `nibot sync <bookid> [--yes]` | 基于最新章节生成设定变更 diff，确认后应用（`--yes` 跳过确认） |
| `nibot gui [--port <n>] [--dir <path>] [--open]` | 启动本地写作台（Web GUI） |
| `nibot provider add` | 交互式添加 provider |
| `nibot provider list` | 列出所有 provider |
| `nibot provider set-default <name>` | 设置默认 provider |

---

## 写作台（GUI）

`nibot gui` 会在本地启动一个可视化写作台（默认 `http://127.0.0.1:4317`，仅监听本机回环地址）：

```bash
cd my-books/       # 书籍根目录（与 CLI 相同的目录约定）
nibot gui --open   # 启动并自动打开浏览器
```

写作台以富文本写作为核心，AI 为辅助：

- **直接写作**：左侧选择章节或设定文件（大纲/世界状态/角色），中间编辑器直接编辑，支持 `Cmd/Ctrl+S` 与自动保存，内容以 Markdown 原样保存（零失真往返）。
- **AI 写新章 / 续写本章**：右侧面板输入作者意图、选择 provider 后流式生成；续写会让 AI 输出整章替换稿（与 `nibot complete` 语义一致）。生成期间编辑器锁定，可随时点击"停止生成"——停止后文件保持原样。
- **设定同步**：与 `nibot sync` 相同的两段式流程，弹窗展示 diff，确认后才写入 world_state/characters。
- **Provider 管理**：添加、设默认、删除（API key 仅以掩码展示）。

注意事项：

- 章节文件以磁盘为唯一事实源；GUI 与 CLI（或多个 GUI 标签页）同时编辑同一章节时为"后写覆盖"（last-write-wins）。
- provider 配置含明文 API key（`~/.config/nibot/config.json`，权限 0600），因此服务只绑定 `127.0.0.1`，请勿将端口暴露到公网。

### 开发（本仓库）

```bash
npm install
npm run dev -- gui --dir <书籍目录>   # 启动 API 服务（4317）
npm run dev:web                       # 启动 Vite 开发服务器（5173，代理 /api）
```

前端位于 `web/`（React + Vite），通过 `src/shared/bridge.ts` 中的 `NibotBridge` 类型接口访问后端（当前为 HTTP + NDJSON 流实现）。后续打包 Electron 时由 preload 注入 `window.nibotBridge`（IPC 实现），渲染层无需改动。
