import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BrowserWindow, Menu, app, dialog, shell } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';

import { startServer } from '../../src/server/index.js';

interface DesktopConfig {
  booksDir?: string;
}

let serverUrl = '';

// 绿色（免安装）模式：程序目录旁存在 data/ 时，provider 配置、书籍和 Chromium
// 缓存全部写进该目录，机器上不留痕迹。免安装 zip 包自带这个目录；安装版没有，
// 于是照旧使用系统目录并与 CLI 共享同一份 ~/.config/nibot。
const portableDataDir = resolvePortableDataDir();

if (portableDataDir) {
  // Must happen before anything touches userData (including the single-instance
  // lock below), and app.setPath only accepts this before the app is ready.
  app.setPath('userData', join(portableDataDir, 'app'));
}

function resolvePortableDataDir(): string | null {
  if (!app.isPackaged) {
    return null;
  }

  const dir = join(appContainerDir(), 'data');
  return existsSync(dir) ? dir : null;
}

// The directory the user sees the app as living in: next to Nibot.exe on
// Windows, and next to Nibot.app on macOS (getPath('exe') points at the binary
// buried three levels inside the bundle).
function appContainerDir(): string {
  const exeDir = dirname(app.getPath('exe'));
  return process.platform === 'darwin' ? resolve(exeDir, '..', '..', '..') : exeDir;
}

function configPath(): string {
  return join(app.getPath('userData'), 'desktop.json');
}

function loadConfig(): DesktopConfig {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8')) as DesktopConfig;
  } catch {
    return {};
  }
}

function saveConfig(config: DesktopConfig): void {
  mkdirSync(app.getPath('userData'), { recursive: true });
  writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`);
}

// Books live in a user-visible folder (not userData) so they survive an app
// uninstall and stay editable with the CLI or any other editor. In portable
// mode that folder travels with the app instead.
function resolveBooksDir(): string {
  const configured = loadConfig().booksDir;
  if (configured && existsSync(configured)) {
    return configured;
  }
  const fallback = portableDataDir
    ? join(portableDataDir, 'books')
    : join(app.getPath('documents'), 'Nibot');
  mkdirSync(fallback, { recursive: true });
  return fallback;
}

async function chooseBooksDir(): Promise<void> {
  const result = await dialog.showOpenDialog({
    title: '选择书籍目录',
    buttonLabel: '使用此目录',
    defaultPath: resolveBooksDir(),
    properties: ['openDirectory', 'createDirectory'],
  });

  const dir = result.filePaths[0];
  if (result.canceled || !dir) {
    return;
  }

  saveConfig({ ...loadConfig(), booksDir: dir });
  // The embedded server resolves books against a fixed cwd; relaunching is the
  // simplest way to re-root everything (server, open editors, query caches).
  app.relaunch();
  app.exit(0);
}

function buildMenu(): Menu {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } satisfies MenuItemConstructorOptions] : []),
    {
      label: '文件',
      submenu: [
        { label: '选择书籍目录…', click: () => void chooseBooksDir() },
        {
          label: isMac ? '在访达中显示书籍目录' : '打开书籍目录',
          click: () => void shell.openPath(resolveBooksDir()),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { label: '编辑', role: 'editMenu' },
    { label: '视图', role: 'viewMenu' },
    { label: '窗口', role: 'windowMenu' },
  ];
  return Menu.buildFromTemplate(template);
}

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    title: 'Nibot',
    backgroundColor: '#ffffff',
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 16 } }
      : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  const loadUrl = process.platform === 'darwin' ? `${serverUrl}?titlebar=inset` : serverUrl;
  await win.loadURL(loadUrl);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) {
        win.restore();
      }
      win.focus();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app
    .whenReady()
    .then(async () => {
      const webRoot = fileURLToPath(new URL('./web/', import.meta.url));
      // Port 0: the OS picks a free loopback port, so a running `nibot gui`
      // (default 4317) never conflicts with the desktop app. homeDir stays
      // unset outside portable mode, so provider config resolves exactly like
      // the CLI (XDG/~/.config); portable mode redirects it into data/.config.
      const { url } = await startServer({
        cwd: resolveBooksDir(),
        homeDir: portableDataDir ?? undefined,
        port: 0,
        webRoot,
      });
      serverUrl = url;
      console.log(`Nibot server listening on ${serverUrl}`);

      Menu.setApplicationMenu(buildMenu());
      await createWindow();

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          void createWindow();
        }
      });
    })
    .catch((error: unknown) => {
      dialog.showErrorBox(
        'Nibot 启动失败',
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
      app.exit(1);
    });
}
