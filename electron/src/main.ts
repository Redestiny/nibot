import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BrowserWindow, Menu, app, dialog, shell } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';

import { startServer } from '../../src/server/index.js';

interface DesktopConfig {
  booksDir?: string;
}

let serverUrl = '';

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
// uninstall and stay editable with the CLI or any other editor.
function resolveBooksDir(): string {
  const configured = loadConfig().booksDir;
  if (configured && existsSync(configured)) {
    return configured;
  }
  const fallback = join(app.getPath('documents'), 'Nibot');
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

  await win.loadURL(serverUrl);
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
      // unset so provider config resolves exactly like the CLI (XDG/~/.config).
      const { url } = await startServer({
        cwd: resolveBooksDir(),
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
