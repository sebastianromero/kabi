import { app, BrowserWindow, Menu, dialog, ipcMain, protocol, net, screen, shell } from 'electron';
import { watch, type FSWatcher } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import started from 'electron-squirrel-startup';
import { loadKbEntries } from '@/lib/kb-data';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'kb-file',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

if (started) {
  app.quit();
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const SECURITY_CSP =
  "default-src 'self' http://127.0.0.1:* http://localhost:*; script-src 'self' 'unsafe-inline' http://127.0.0.1:* http://localhost:*; style-src 'self' 'unsafe-inline' http://127.0.0.1:* http://localhost:*; img-src 'self' data: blob: kb-file: http://127.0.0.1:* http://localhost:*; font-src 'self' data: http://127.0.0.1:* http://localhost:*; connect-src 'self' ws://127.0.0.1:* ws://localhost:* http://127.0.0.1:* http://localhost:*; object-src 'none'; base-uri 'self';";

let cspHeadersInstalled = false;
let activeServer: Server | null = null;
let activeServerUrl: string | null = null;
let mainWindowRef: BrowserWindow | null = null;
let preferencesWindowRef: BrowserWindow | null = null;
let activeVaultRoot = '';
let lastBuiltVaultRoot: string | null = null;
let activeVaultWatcher: FSWatcher | null = null;
let entriesChangedTimer: NodeJS.Timeout | null = null;

const SETTINGS_FILE_NAME = 'settings.json';
const WINDOW_STATE_FILE_NAME = 'window-state.json';
const MAIN_WINDOW_MIN_WIDTH = 820;
const MAIN_WINDOW_MIN_HEIGHT = 560;

type WindowState = {
  width: number;
  height: number;
  x?: number;
  y?: number;
};

const getContentType = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
};

const resolveStaticFilePath = async (rootDir: string, requestPath: string): Promise<string | null> => {
  const normalizedRequestPath = path.posix.normalize(`/${requestPath || '/'}`);
  const requestWithoutLeadingSlash = normalizedRequestPath.replace(/^\/+/, '');

  const candidates = requestWithoutLeadingSlash.endsWith('/')
    ? [
        path.join(rootDir, requestWithoutLeadingSlash, 'index.html'),
        path.join(rootDir, requestWithoutLeadingSlash),
      ]
    : [
        path.join(rootDir, requestWithoutLeadingSlash),
        path.join(rootDir, requestWithoutLeadingSlash, 'index.html'),
      ];

  const resolvedRoot = path.resolve(rootDir);

  for (const candidate of candidates) {
    const resolvedCandidate = path.resolve(candidate);
    if (!resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`) && resolvedCandidate !== resolvedRoot) {
      continue;
    }

    try {
      const stat = await fs.stat(resolvedCandidate);
      if (stat.isFile()) {
        return resolvedCandidate;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return null;
};

const startStaticServer = async (rootDir: string): Promise<{ server: Server; url: string }> => {
  const server = createServer(async (req, res) => {
    try {
      const rawPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
      const resolvedPath = await resolveStaticFilePath(rootDir, rawPath);

      if (!resolvedPath) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }

      const fileContent = await fs.readFile(resolvedPath);
      res.writeHead(200, { 'Content-Type': getContentType(resolvedPath) });
      res.end(fileContent);
    } catch {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Unable to determine local server address.');
  }

  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
  };
};

const ensureCspHeaders = (mainWindow: BrowserWindow): void => {
  if (cspHeadersInstalled) {
    return;
  }

  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = details.responseHeaders ?? {};
    responseHeaders['Content-Security-Policy'] = [SECURITY_CSP];
    callback({ responseHeaders });
  });

  cspHeadersInstalled = true;
};

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const runAstroBuild = async (): Promise<void> => {
  const buildEnv = {
    ...process.env,
    ...(activeVaultRoot ? { KB_ROOT: activeVaultRoot } : {}),
  };

  await new Promise<void>((resolve, reject) => {
    const packageManager = process.env.npm_config_user_agent?.includes('bun')
      ? 'bun'
      : 'npm';
    const args = packageManager === 'bun' ? ['run', 'web:build'] : ['run', 'web:build'];
    const child = spawn(packageManager, args, {
      cwd: app.getAppPath(),
      env: buildEnv,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`web:build failed with exit code ${code ?? 'unknown'}`));
      }
    });
  });
};

const getSettingsPath = (): string => path.join(app.getPath('userData'), SETTINGS_FILE_NAME);
const getWindowStatePath = (): string => path.join(app.getPath('userData'), WINDOW_STATE_FILE_NAME);

const getDefaultWindowState = (): WindowState => {
  const display = screen.getPrimaryDisplay();
  const workArea = display.workArea;

  const width = Math.max(MAIN_WINDOW_MIN_WIDTH, Math.floor(workArea.width * 0.8));
  const height = Math.max(MAIN_WINDOW_MIN_HEIGHT, Math.floor(workArea.height * 0.8));
  const x = Math.floor(workArea.x + (workArea.width - width) / 2);
  const y = Math.floor(workArea.y + (workArea.height - height) / 2);

  return { width, height, x, y };
};

const isWindowStateVisible = (state: WindowState): boolean => {
  const { x, y, width, height } = state;
  if (typeof x !== 'number' || typeof y !== 'number') {
    return true;
  }

  const displays = screen.getAllDisplays();
  return displays.some((display) => {
    const area = display.workArea;
    return (
      x + width > area.x &&
      y + height > area.y &&
      x < area.x + area.width &&
      y < area.y + area.height
    );
  });
};

const loadWindowState = async (): Promise<WindowState> => {
  const fallback = getDefaultWindowState();

  try {
    const raw = await fs.readFile(getWindowStatePath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<WindowState>;

    if (typeof parsed.width !== 'number' || typeof parsed.height !== 'number') {
      return fallback;
    }

    const state: WindowState = {
      width: Math.max(MAIN_WINDOW_MIN_WIDTH, Math.min(Math.floor(parsed.width), 9999)),
      height: Math.max(MAIN_WINDOW_MIN_HEIGHT, Math.min(Math.floor(parsed.height), 9999)),
      x: typeof parsed.x === 'number' ? Math.floor(parsed.x) : undefined,
      y: typeof parsed.y === 'number' ? Math.floor(parsed.y) : undefined,
    };

    if (!isWindowStateVisible(state)) {
      return fallback;
    }

    return state;
  } catch {
    return fallback;
  }
};

const saveWindowState = async (window: BrowserWindow): Promise<void> => {
  if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) {
    return;
  }

  const bounds = window.getBounds();
  const state: WindowState = {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
  };

  try {
    await fs.writeFile(getWindowStatePath(), JSON.stringify(state, null, 2), 'utf-8');
  } catch {
    // Ignore window state persistence errors.
  }
};

const resolveSystemExternalUrl = (rawUrl: string): string | null => {
  try {
    const parsed = new URL(rawUrl);

    switch (parsed.protocol) {
      case 'http:':
      case 'https:':
      case 'mailto:':
      case 'tel:':
      case 'file:':
        return parsed.toString();
      case 'kb-file:': {
        if (parsed.hostname !== 'local') {
          return null;
        }

        const encodedPath = parsed.pathname.replace(/^\/+/, '');
        const decodedPath = decodeURIComponent(encodedPath);
        return pathToFileURL(decodedPath).toString();
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
};

const openUrlInSystem = async (rawUrl: string): Promise<boolean> => {
  const externalUrl = resolveSystemExternalUrl(rawUrl);
  if (!externalUrl) {
    return false;
  }

  try {
    await shell.openExternal(externalUrl);
    return true;
  } catch (error) {
    console.error('Failed to open external URL in system shell:', error);
    return false;
  }
};

const isTrustedAppUrl = (window: BrowserWindow, rawUrl: string): boolean => {
  if (!rawUrl || rawUrl === 'about:blank' || rawUrl.startsWith('data:text/html,')) {
    return true;
  }

  const currentUrl = window.webContents.getURL();
  if (!currentUrl) {
    return false;
  }

  try {
    return new URL(rawUrl).origin === new URL(currentUrl).origin;
  } catch {
    return false;
  }
};

const installExternalNavigationGuards = (window: BrowserWindow): void => {
  window.webContents.setWindowOpenHandler(({ url }) => {
    void openUrlInSystem(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (isTrustedAppUrl(window, url)) {
      return;
    }

    event.preventDefault();
    void openUrlInSystem(url);
  });
};

const normalizeVaultPath = (vaultPath: string): string => {
  const trimmed = vaultPath.trim();
  if (!trimmed) {
    return '';
  }

  return path.resolve(trimmed);
};

const loadSavedVaultPath = async (): Promise<string | null> => {
  try {
    const raw = await fs.readFile(getSettingsPath(), 'utf-8');
    const data = JSON.parse(raw) as { vaultPath?: unknown };
    if (typeof data.vaultPath === 'string' && data.vaultPath.trim()) {
      return data.vaultPath;
    }
    return null;
  } catch {
    return null;
  }
};

const saveVaultPath = async (vaultPath: string): Promise<void> => {
  const payload = JSON.stringify({ vaultPath }, null, 2);
  await fs.writeFile(getSettingsPath(), payload, 'utf-8');
};

const ensureVaultFolderExists = async (vaultPath: string): Promise<void> => {
  await fs.mkdir(vaultPath, { recursive: true });
};

const disposeVaultWatcher = (): void => {
  if (entriesChangedTimer) {
    clearTimeout(entriesChangedTimer);
    entriesChangedTimer = null;
  }

  if (activeVaultWatcher) {
    activeVaultWatcher.close();
    activeVaultWatcher = null;
  }
};

const emitEntriesChanged = (): void => {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('kabi:entries-changed');
  }
};

const scheduleEntriesChanged = (): void => {
  if (entriesChangedTimer) {
    clearTimeout(entriesChangedTimer);
  }

  entriesChangedTimer = setTimeout(() => {
    entriesChangedTimer = null;
    emitEntriesChanged();
  }, 120);
};

const startVaultWatcher = (vaultPath: string): void => {
  disposeVaultWatcher();

  if (!vaultPath) {
    return;
  }

  try {
    activeVaultWatcher = watch(vaultPath, { recursive: true }, (_eventType, fileName) => {
      const changedPath = typeof fileName === 'string' ? fileName.toLowerCase() : '';
      if (changedPath && !/\.(md|mdx)$/.test(changedPath)) {
        return;
      }

      scheduleEntriesChanged();
    });

    activeVaultWatcher.on('error', (error) => {
      console.error('Vault watcher error:', error);
      disposeVaultWatcher();
    });
  } catch (error) {
    console.error('Failed to start vault watcher:', error);
    disposeVaultWatcher();
  }
};

const promptVaultPath = async (): Promise<string | null> => {
  const result = await dialog.showOpenDialog({
    title: 'Select Kabi vault folder',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Use this folder',
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
};

const resolveInitialVaultPath = async (): Promise<string> => {
  const fromEnv = process.env.KB_ROOT?.trim();
  if (fromEnv) {
    const normalized = normalizeVaultPath(fromEnv);
    await ensureVaultFolderExists(normalized);
    await saveVaultPath(normalized);
    console.log('[Main] Using vault from KB_ROOT env:', normalized);
    return normalized;
  }

  const saved = await loadSavedVaultPath();
  if (saved) {
    const normalized = normalizeVaultPath(saved);
    await ensureVaultFolderExists(normalized);
    console.log('[Main] Using vault from saved config:', normalized);
    return normalized;
  }

  console.log('[Main] No vault configured');
  return '';
};

const resolvePreferencesWindowUrl = async (): Promise<string> => {
  const mainWindowUrl = mainWindowRef?.webContents.getURL();
  if (mainWindowUrl) {
    try {
      const parsed = new URL(mainWindowUrl);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return new URL('/preferences', parsed).toString();
      }
    } catch {
      // Continue with fallback resolution.
    }
  }

  const astroDevServerUrl = process.env.KABI_DEV_SERVER_URL?.trim();
  if (!app.isPackaged && astroDevServerUrl) {
    return new URL('/preferences', astroDevServerUrl).toString();
  }

  const distRoot = path.join(app.getAppPath(), 'dist');
  const distPreferencesPath = path.join(distRoot, 'preferences', 'index.html');
  if (await fileExists(distPreferencesPath)) {
    if (!activeServer) {
      const { server, url } = await startStaticServer(distRoot);
      activeServer = server;
      activeServerUrl = url;
    }

    if (activeServerUrl) {
      return `${activeServerUrl}/preferences`;
    }
  }

  throw new Error('Preferences page is unavailable. Ensure /preferences is included in the renderer build.');
};

const openPreferencesWindow = async (): Promise<void> => {
  if (preferencesWindowRef && !preferencesWindowRef.isDestroyed()) {
    preferencesWindowRef.focus();
    return;
  }

  const parentWindow = mainWindowRef && !mainWindowRef.isDestroyed() ? mainWindowRef : undefined;
  const preferencesWindow = new BrowserWindow({
    width: 920,
    height: 640,
    minWidth: 860,
    minHeight: 600,
    title: 'Preferences',
    parent: parentWindow,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  preferencesWindowRef = preferencesWindow;
  preferencesWindow.on('closed', () => {
    preferencesWindowRef = null;
  });

  await preferencesWindow.loadURL(await resolvePreferencesWindowUrl());
  installExternalNavigationGuards(preferencesWindow);
};

const loadAppContent = async (mainWindow: BrowserWindow): Promise<void> => {
  const distRoot = path.join(app.getAppPath(), 'dist');
  const distIndexPath = path.join(distRoot, 'index.html');

  const astroDevServerUrl = process.env.KABI_DEV_SERVER_URL?.trim();

  if (!app.isPackaged && astroDevServerUrl) {
    if (activeServer) {
      activeServer.close();
      activeServer = null;
      activeServerUrl = null;
    }

    await mainWindow.loadURL(astroDevServerUrl);
    return;
  }

  const hasDist = await fileExists(distIndexPath);
  const canBuildAtRuntime = !app.isPackaged && process.env.KABI_RUNTIME_BUILD === '1';
  const shouldBuild = canBuildAtRuntime && (!hasDist || lastBuiltVaultRoot !== activeVaultRoot);

  if (shouldBuild) {
    await runAstroBuild();
    lastBuiltVaultRoot = activeVaultRoot;
  }

  if (activeServer) {
    activeServer.close();
    activeServer = null;
    activeServerUrl = null;
  }

  if (await fileExists(distIndexPath)) {
    const { server, url } = await startStaticServer(distRoot);
    activeServer = server;
    activeServerUrl = url;
    await mainWindow.loadURL(url);
    return;
  }

  if (app.isPackaged) {
    throw new Error('Packaged app is missing dist/index.html. Run `bun run web:build` before packaging.');
  }

  throw new Error('Development app content is unavailable. Start with `bun dev` so Astro dev server is provided.');
};

ipcMain.handle('kabi:select-vault', async () => {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) {
    return false;
  }

  const selected = await promptVaultPath();
  if (!selected) {
    console.log('[Main] User cancelled vault selection');
    return false;
  }

  const normalizedSelection = normalizeVaultPath(selected);
  const normalizedCurrent = normalizeVaultPath(activeVaultRoot);

  if (normalizedSelection === normalizedCurrent) {
    console.log('[Main] Selected vault is same as current:', normalizedSelection);
    return true;
  }

  console.log('[Main] Setting new vault:', normalizedSelection);
  activeVaultRoot = normalizedSelection;
  await ensureVaultFolderExists(activeVaultRoot);
  await saveVaultPath(activeVaultRoot);
  startVaultWatcher(activeVaultRoot);
  mainWindowRef.webContents.send('kabi:vault-changed', activeVaultRoot);
  if (preferencesWindowRef && !preferencesWindowRef.isDestroyed()) {
    preferencesWindowRef.webContents.send('kabi:vault-changed', activeVaultRoot);
  }
  console.log('[Main] Vault changed event sent, activeVaultRoot is now:', activeVaultRoot);
  return true;
});

ipcMain.handle('kabi:get-vault-path', async () => {
  console.log('[Main] get-vault-path:', activeVaultRoot);
  return activeVaultRoot;
});

ipcMain.handle('kabi:get-entries', async () => {
  console.log('[Main] get-entries, activeVaultRoot:', activeVaultRoot);
  if (!activeVaultRoot) {
    console.log('[Main] activeVaultRoot is empty, returning []');
    return [];
  }

  try {
    const entries = await loadKbEntries(activeVaultRoot);
    console.log('[Main] loaded entries:', entries.length);
    return entries;
  } catch (error) {
    console.error('[Main] Failed to load vault entries:', error);
    return [];
  }
});

ipcMain.handle('kabi:open-preferences-window', async () => {
  await openPreferencesWindow();
});

ipcMain.handle('kabi:show-folder-context-menu', async (event) => {
  const ownerWindow = BrowserWindow.fromWebContents(event.sender);

  return await new Promise<'open' | null>((resolve) => {
    let resolved = false;
    const finish = (result: 'open' | null): void => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    const menu = Menu.buildFromTemplate([
      {
        label: 'Open',
        click: () => finish('open'),
      },
    ]);

    menu.popup({
      window: ownerWindow ?? undefined,
      callback: () => finish(null),
    });
  });
});

const installAppMenu = (): void => {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        {
          label: 'Preferences...',
          accelerator: 'CommandOrControl+,',
          click: () => {
            void openPreferencesWindow();
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      role: 'editMenu',
    },
    {
      role: 'windowMenu',
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

const createWindow = async () => {
  const windowState = await loadWindowState();
  const mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    minWidth: MAIN_WINDOW_MIN_WIDTH,
    minHeight: MAIN_WINDOW_MIN_HEIGHT,
    ...(typeof windowState.x === 'number' ? { x: windowState.x } : {}),
    ...(typeof windowState.y === 'number' ? { y: windowState.y } : {}),
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  mainWindowRef = mainWindow;

  let saveTimer: NodeJS.Timeout | null = null;
  const scheduleSaveWindowState = (): void => {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }

    saveTimer = setTimeout(() => {
      void saveWindowState(mainWindow);
      saveTimer = null;
    }, 180);
  };

  mainWindow.on('move', scheduleSaveWindowState);
  mainWindow.on('resize', scheduleSaveWindowState);

  ensureCspHeaders(mainWindow);

  try {
    await loadAppContent(mainWindow);
    installExternalNavigationGuards(mainWindow);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown startup error';
    await mainWindow.loadURL(
      `data:text/html,${encodeURIComponent(`<h1>Kabi failed to start</h1><pre>${reason}</pre>`)}`,
    );
    installExternalNavigationGuards(mainWindow);
  }

  mainWindow.on('closed', () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    void saveWindowState(mainWindow);
    if (activeServer) {
      activeServer.close();
      activeServer = null;
      activeServerUrl = null;
    }
    disposeVaultWatcher();
    mainWindowRef = null;
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
};

app.on('ready', () => {
  protocol.handle('kb-file', (request) => {
    try {
      const parsed = new URL(request.url);
      const encodedPath = parsed.pathname.replace(/^\/+/, '');
      const decodedPath = decodeURIComponent(encodedPath);
      const fileUrl = pathToFileURL(decodedPath).toString();
      return net.fetch(fileUrl);
    } catch {
      return new Response('Invalid kb-file path', { status: 400 });
    }
  });

  installAppMenu();
  void resolveInitialVaultPath().then((vaultPath) => {
    activeVaultRoot = vaultPath;
    console.log('[Main] Initialized activeVaultRoot:', activeVaultRoot);
    lastBuiltVaultRoot = normalizeVaultPath(vaultPath);
    startVaultWatcher(activeVaultRoot);
    void createWindow();
  });
});

app.on('second-instance', () => {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    if (mainWindowRef.isMinimized()) {
      mainWindowRef.restore();
    }
    mainWindowRef.focus();
    return;
  }

  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

app.on('window-all-closed', () => {
  disposeVaultWatcher();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
