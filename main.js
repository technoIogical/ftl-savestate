const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

function getFileHash(filePath) {
    if (!fs.existsSync(filePath)) return null;
    const fileBuffer = fs.readFileSync(filePath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
}

// # ── Configuration ──────────
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
let settings = { statesPath: '', activeState: '' };

if (fs.existsSync(settingsPath)) {
    settings = JSON.parse(fs.readFileSync(settingsPath));
}

function getFTLSavePath() {
    const home = os.homedir();
    if (process.platform === 'win32') {
        return path.join(home, 'Documents', 'My Games', 'FasterThanLight');
    } else if (process.platform === 'darwin') {
        return path.join(home, 'Library', 'Application Support', 'FasterThanLight');
    } else {
        return path.join(home, '.local', 'share', 'FasterThanLight');
    }
}

const FTL_PATH = getFTLSavePath();
const DEFAULT_STATES_PATH = path.join(FTL_PATH, 'SaveStates');
let STATES_PATH = settings.statesPath || DEFAULT_STATES_PATH;

function ensureStatesDir() {
    if (!fs.existsSync(STATES_PATH)) {
        fs.mkdirSync(STATES_PATH, { recursive: true });
    }
}
ensureStatesDir();

// # ── Window Management ──────────

function createWindow() {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    win.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// # ── IPC Handlers ──────────

ipcMain.handle('get-states', async () => {
    if (!fs.existsSync(STATES_PATH)) return [];
    return fs.readdirSync(STATES_PATH)
        .filter(f => fs.statSync(path.join(STATES_PATH, f)).isDirectory())
        .map(name => ({
            name,
            ctime: fs.statSync(path.join(STATES_PATH, name)).ctime
        }))
        .sort((a, b) => b.ctime - a.ctime);
});

ipcMain.handle('create-state', async (event, name, type) => {
    const stateDir = path.join(STATES_PATH, name);
    if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir);

    const filesInDir = fs.readdirSync(FTL_PATH);
    const filesToCopy = type === 'run'
        ? filesInDir.filter(f => f.toLowerCase().endsWith('continue.sav'))
        : filesInDir.filter(f => (f.toLowerCase().endsWith('.sav') && !f.toLowerCase().endsWith('continue.sav')) || f.toLowerCase().includes('version'));

    filesToCopy.forEach(file => {
        const src = path.join(FTL_PATH, file);
        fs.copyFileSync(src, path.join(stateDir, file));
    });

    settings.activeState = name;
    fs.writeFileSync(settingsPath, JSON.stringify(settings));
    return true;
});

ipcMain.handle('load-state', async (event, name) => {
    const stateDir = path.join(STATES_PATH, name);
    if (!fs.existsSync(stateDir)) return false;

    const files = fs.readdirSync(stateDir);
    console.log(`Loading state ${name}: overwriting ${files.length} files in ${FTL_PATH}`);
    files.forEach(file => {
        const src = path.join(stateDir, file);
        const dest = path.join(FTL_PATH, file);
        try {
            fs.copyFileSync(src, dest);
            console.log(`Restored ${file}`);
        } catch (e) {
            console.error(`Failed to restore ${file}: ${e.message}`);
        }
    });

    settings.activeState = name;
    fs.writeFileSync(settingsPath, JSON.stringify(settings));
    return true;
});

ipcMain.handle('get-active-state', async () => {
    // Check both potential run files to see which is most relevant
    const runFiles = ['hs_mv_continue.sav', 'continue.sav'];
    let activeFile = '';
    for (const f of runFiles) {
        const p = path.join(FTL_PATH, f);
        if (fs.existsSync(p)) {
            activeFile = p;
            break;
        }
    }

    if (!activeFile) return settings.activeState;

    const activeHash = getFileHash(activeFile);
    if (!activeHash) return settings.activeState;

    const states = fs.readdirSync(STATES_PATH).filter(f => fs.statSync(path.join(STATES_PATH, f)).isDirectory());
    for (const state of states) {
        // Check if any file in the state matches the active file's hash
        const stateFiles = fs.readdirSync(path.join(STATES_PATH, state));
        for (const sf of stateFiles) {
            if (getFileHash(path.join(STATES_PATH, state, sf)) === activeHash) {
                return state;
            }
        }
    }

    return settings.activeState;
});

ipcMain.handle('delete-state', async (event, name) => {
    const stateDir = path.join(STATES_PATH, name);
    if (fs.existsSync(stateDir)) {
        fs.rmSync(stateDir, { recursive: true, force: true });
    }
    return true;
});

ipcMain.handle('open-save-folder', async () => {
    shell.openPath(FTL_PATH);
    return true;
});

ipcMain.handle('select-states-folder', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog({
        title: 'Select Save States Folder',
        buttonLabel: 'Select Folder',
        properties: ['openDirectory', 'createDirectory']
    });
    if (!result.canceled && result.filePaths.length > 0) {
        STATES_PATH = result.filePaths[0];
        settings.statesPath = STATES_PATH;
        fs.writeFileSync(settingsPath, JSON.stringify(settings));
        ensureStatesDir();
        return STATES_PATH;
    }
    return null;
});

ipcMain.handle('is-ftl-running', async () => {
    const { exec } = require('child_process');
    const command = process.platform === 'win32'
        ? 'tasklist /FI "IMAGENAME eq FTLGame.exe" /NH'
        : 'pgrep FTLGame';

    return new Promise((resolve) => {
        exec(command, (err, stdout) => {
            resolve(stdout && stdout.toLowerCase().includes('ftlgame'));
        });
    });
});

ipcMain.handle('get-current-states-path', async () => {
    return STATES_PATH;
});
