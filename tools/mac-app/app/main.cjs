// Electron main process for the packaged, read-only AI Lecturer.
//
// Layout inside the .app (built by ../build.mjs):
//   Contents/Resources/payload/node              bundled Node binary
//   Contents/Resources/payload/server/server.js  Next standalone server
//   Contents/Resources/payload/courses/<slug>/   exported courses
//   Contents/Resources/payload/collections.json  only the exported collection
//
// Learner state (progress, tutor chats, chat images) lives in
// ~/Library/Application Support/<app name>/data, so it survives app updates.
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const CLAUDE_INSTALL_URL = 'https://docs.claude.com/en/docs/claude-code/setup';

let server = null;
let serverUrl = null;
let mainWindow = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(start);
}

function payloadDir() {
  return path.join(process.resourcesPath, 'payload');
}

function dataDir() {
  const dir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function logFile() {
  const dir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'server.log');
}

// Apps launched from Finder get a bare PATH (/usr/bin:/bin:...), so `claude`
// (usually ~/.local/bin) is invisible. Ask the login shell for the real PATH
// and add the usual install locations on top.
function resolvePath() {
  const parts = [];
  try {
    const shellBin = process.env.SHELL || '/bin/zsh';
    const out = execFileSync(shellBin, ['-ilc', 'printf "__PATH__%s" "$PATH"'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const i = out.lastIndexOf('__PATH__');
    if (i >= 0) parts.push(...out.slice(i + 8).trim().split(':'));
  } catch {
    // fall through to the static list
  }
  const home = os.homedir();
  parts.push(
    path.join(home, '.local', 'bin'),
    path.join(home, '.claude', 'local'),
    path.join(home, '.npm-global', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    ...(process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin').split(':'),
  );
  return [...new Set(parts.filter(Boolean))].join(':');
}

function findOnPath(bin, pathValue) {
  for (const dir of pathValue.split(':')) {
    const candidate = path.join(dir, bin);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (server === null || server.exitCode !== null) {
          reject(new Error('server exited during startup'));
        } else if (Date.now() > deadline) {
          reject(new Error('server did not start in time'));
        } else {
          setTimeout(attempt, 250);
        }
      });
      req.setTimeout(2000, () => req.destroy());
    };
    attempt();
  });
}

function tailLog() {
  try {
    return fs.readFileSync(logFile(), 'utf8').split('\n').slice(-25).join('\n');
  } catch {
    return '';
  }
}

function appConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(payloadDir(), 'app-config.json'), 'utf8'));
  } catch {
    return {};
  }
}

async function startServer(pathValue) {
  const payload = payloadDir();
  const data = dataDir();
  const config = appConfig();
  const port = await freePort();
  const log = fs.createWriteStream(logFile(), { flags: 'w' });

  server = spawn(path.join(payload, 'node'), [path.join(payload, 'server', 'server.js')], {
    cwd: path.join(payload, 'server'),
    env: {
      ...process.env,
      // `claude` finds its Keychain login via USER; launchd normally sets it,
      // but don't let the tutor silently report "Not logged in" if it didn't.
      USER: process.env.USER || os.userInfo().username,
      LOGNAME: process.env.LOGNAME || os.userInfo().username,
      PATH: pathValue,
      NODE_ENV: 'production',
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      NEXT_TELEMETRY_DISABLED: '1',
      AI_LECTURER_READ_ONLY: '1',
      AI_LECTURER_SKIN: config.skin || '',
      AI_LECTURER_TUTOR_DEFAULT_OPEN: '1',
      COURSES_ROOT_OVERRIDE: path.join(payload, 'courses'),
      COLLECTIONS_FILE_OVERRIDE: path.join(payload, 'collections.json'),
      CHATS_ROOT_OVERRIDE: path.join(data, 'chats'),
      CHAT_MEDIA_ROOT_OVERRIDE: path.join(data, 'chat-media'),
      PROGRESS_FILE_OVERRIDE: path.join(data, 'progress.json'),
      AI_LECTURER_HOME_OVERRIDE: data,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.pipe(log);
  server.stderr.pipe(log);
  server.on('exit', (code) => {
    if (quitting) return;
    dialog.showErrorBox(
      'AI Lecturer przestał działać',
      `Serwer aplikacji zakończył pracę (kod ${code}). Uruchom aplikację ponownie.\n\n${tailLog()}`,
    );
    app.quit();
  });

  serverUrl = `http://127.0.0.1:${port}`;
  await waitForServer(serverUrl, 60000);
}

// Zips the tutor transcripts (+ the images they reference) so the learner can
// send them back; the layout matches ~/.ai-lecturer (chats/, chat-media/).
async function exportChats() {
  const data = dataDir();
  const parts = ['chats', 'chat-media'].filter((d) => fs.existsSync(path.join(data, d)));
  if (!parts.includes('chats')) {
    dialog.showMessageBox({ type: 'info', message: 'Brak zapisanych rozmów z tutorem.' });
    return;
  }
  const date = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Eksportuj rozmowy z tutorem',
    defaultPath: path.join(app.getPath('desktop'), `AI-Lecturer-rozmowy-${date}.zip`),
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
  });
  if (canceled || !filePath) return;
  try {
    fs.rmSync(filePath, { force: true });
    execFileSync('zip', ['-r', '-q', filePath, ...parts, '-x', '*.DS_Store'], { cwd: data });
    shell.showItemInFolder(filePath);
  } catch (err) {
    dialog.showErrorBox('Eksport nie powiódł się', String(err.message || err));
  }
}

function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: `O aplikacji ${app.name}` },
        { type: 'separator' },
        { label: 'Eksportuj rozmowy z tutorem…', accelerator: 'CmdOrCtrl+E', click: exportChats },
        { type: 'separator' },
        { role: 'hide', label: 'Ukryj' },
        { role: 'hideOthers', label: 'Ukryj pozostałe' },
        { type: 'separator' },
        { role: 'quit', label: 'Zakończ' },
      ],
    },
    {
      label: 'Edycja',
      submenu: [
        { role: 'undo', label: 'Cofnij' },
        { role: 'redo', label: 'Powtórz' },
        { type: 'separator' },
        { role: 'cut', label: 'Wytnij' },
        { role: 'copy', label: 'Kopiuj' },
        { role: 'paste', label: 'Wklej' },
        { role: 'selectAll', label: 'Zaznacz wszystko' },
      ],
    },
    {
      label: 'Widok',
      submenu: [
        {
          label: 'Strona główna',
          accelerator: 'CmdOrCtrl+Shift+H',
          click: () => mainWindow && mainWindow.loadURL(serverUrl),
        },
        { role: 'reload', label: 'Odśwież' },
        { type: 'separator' },
        { role: 'zoomIn', label: 'Powiększ' },
        { role: 'zoomOut', label: 'Pomniejsz' },
        { role: 'resetZoom', label: 'Rzeczywisty rozmiar' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Pełny ekran' },
      ],
    },
    {
      label: 'Nawigacja',
      submenu: [
        {
          label: 'Wstecz',
          accelerator: 'CmdOrCtrl+[',
          click: () => mainWindow && mainWindow.webContents.navigationHistory.goBack(),
        },
        {
          label: 'Dalej',
          accelerator: 'CmdOrCtrl+]',
          click: () => mainWindow && mainWindow.webContents.navigationHistory.goForward(),
        },
      ],
    },
    { role: 'windowMenu', label: 'Okno' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: app.name,
    webPreferences: { contextIsolation: true, sandbox: true },
  });

  // Anything outside the local server (sources, PubMed, …) opens in the
  // default browser instead of replacing the app.
  const isLocal = (url) => url.startsWith(serverUrl);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isLocal(url)) shell.openExternal(url);
    return { action: isLocal(url) ? 'allow' : 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!isLocal(url)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.loadURL(serverUrl);
}

async function start() {
  buildMenu();

  // A zip copied over AirDrop/USB carries the quarantine flag onto every file;
  // the bundled node binary would then be blocked when we exec it.
  try {
    execFileSync('xattr', ['-dr', 'com.apple.quarantine', payloadDir()], { stdio: 'ignore' });
  } catch {
    // not quarantined, or no permission: nothing to do
  }

  const pathValue = resolvePath();
  if (!findOnPath('claude', pathValue)) {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: 'Brak Claude Code',
      message: 'Nie znaleziono programu „claude” na tym komputerze.',
      detail:
        'Kursy będą działać, ale asystent AI (czat w lekcjach) nie odpowie, ' +
        'dopóki Claude Code nie zostanie zainstalowany i zalogowany.\n\n' +
        'Instalacja (Terminal):\n  curl -fsSL https://claude.ai/install.sh | bash\n' +
        'potem jednorazowo:  claude   (i zaloguj się)',
      buttons: ['Kontynuuj', 'Instrukcja instalacji'],
      defaultId: 0,
    });
    if (response === 1) shell.openExternal(CLAUDE_INSTALL_URL);
  }

  try {
    await startServer(pathValue);
  } catch (err) {
    dialog.showErrorBox(
      'Nie udało się uruchomić AI Lecturera',
      `${err.message}\n\nLog: ${logFile()}\n\n${tailLog()}`,
    );
    app.quit();
    return;
  }
  createWindow();
}

app.on('activate', () => {
  if (mainWindow === null && serverUrl) createWindow();
});

app.on('window-all-closed', () => app.quit());

app.on('before-quit', () => {
  quitting = true;
  if (server && server.exitCode === null) server.kill('SIGTERM');
});
