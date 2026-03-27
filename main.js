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
let settings = { statesPath: '', activeState: '', autoBackup: false };

if (fs.existsSync(settingsPath)) {
    try {
        const saved = JSON.parse(fs.readFileSync(settingsPath));
        settings = { ...settings, ...saved };
    } catch (e) { }
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
        width: 900,
        height: 700,
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

// # ── Save Parsing ──────────

function parseSaveInfo(filePath) {
    try {
        if (!fs.existsSync(filePath)) return null;
        const buffer = fs.readFileSync(filePath);
        let offset = 0;

        const version = buffer.readInt32LE(0);

        // Multiverse / Hyperspace often has the name length at 32
        // while Vanilla 1.6 has it at 48.
        // We'll try to detect by looking at the string at 36 vs 52.

        let nameLen = buffer.readInt32LE(32);
        let sectorOffset = 28;
        let nameOffset = 36;

        if (nameLen <= 0 || nameLen > 100) {
            // Try Vanilla 1.6 offsets
            nameLen = buffer.readInt32LE(48);
            sectorOffset = 44; // Guessing sector is before name
            nameOffset = 52;
        }

        if (nameLen <= 0 || nameLen > 100) return null;

        const shipName = buffer.toString('utf8', nameOffset, nameOffset + nameLen).replace(/[^\x20-\x7E]/g, '');
        const sector = buffer.readInt32LE(sectorOffset) + 1;

        // Try to get ship type (after ship name)
        const typeLenOffset = nameOffset + nameLen;
        const shipTypeLen = buffer.readInt32LE(typeLenOffset);
        const shipType = buffer.toString('utf8', typeLenOffset + 4, typeLenOffset + 4 + shipTypeLen).replace(/[^\x20-\x7E]/g, '');

        if (sector < 1 || sector > 20) return { shipName, shipType, sector: '?' };
        return { shipName, shipType, sector };
    } catch (e) {
        return null;
    }
}

// # ── IPC Handlers ──────────

ipcMain.handle('get-states', async () => {
    if (!fs.existsSync(STATES_PATH)) return [];
    try {
        const dirs = fs.readdirSync(STATES_PATH).filter(f => {
            try { return fs.statSync(path.join(STATES_PATH, f)).isDirectory(); } catch (e) { return false; }
        });

        return dirs.map(name => {
            const stateDir = path.join(STATES_PATH, name);
            const stats = fs.statSync(stateDir);
            let info = null;
            const runFiles = ['hs_mv_continue.sav', 'continue.sav'];
            for (const f of runFiles) {
                const p = path.join(stateDir, f);
                if (fs.existsSync(p)) {
                    info = parseSaveInfo(p);
                    if (info) break;
                }
            }
            return { name, ctime: stats.ctime, info };
        }).sort((a, b) => b.ctime - a.ctime);
    } catch (e) {
        return [];
    }
});

ipcMain.handle('create-state', async (event, name, type) => {
    try {
        const sanitizedName = name.replace(/[<>:"/\\|?*]/g, '').trim();
        if (!sanitizedName) return { success: false, error: 'Invalid name.' };

        const stateDir = path.join(STATES_PATH, sanitizedName);
        if (!fs.existsSync(STATES_PATH)) fs.mkdirSync(STATES_PATH, { recursive: true });
        if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });

        const filesInDir = fs.readdirSync(FTL_PATH);
        const filesToCopy = type === 'run'
            ? filesInDir.filter(f => f.toLowerCase().endsWith('continue.sav'))
            : filesInDir.filter(f => (f.toLowerCase().endsWith('.sav') && !f.toLowerCase().endsWith('continue.sav')) || f.toLowerCase().includes('version'));

        if (filesToCopy.length === 0) return { success: false, error: 'No save files found.' };

        filesToCopy.forEach(file => {
            fs.copyFileSync(path.join(FTL_PATH, file), path.join(stateDir, file));
        });

        settings.activeState = sanitizedName;
        fs.writeFileSync(settingsPath, JSON.stringify(settings));
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('load-state', async (event, name) => {
    const stateDir = path.join(STATES_PATH, name);
    if (!fs.existsSync(stateDir)) return false;

    fs.readdirSync(stateDir).forEach(file => {
        fs.copyFileSync(path.join(stateDir, file), path.join(FTL_PATH, file));
    });

    settings.activeState = name;
    fs.writeFileSync(settingsPath, JSON.stringify(settings));
    return true;
});

ipcMain.handle('get-active-state', async () => {
    const runFiles = ['hs_mv_continue.sav', 'continue.sav'];
    let activeFile = '';
    for (const f of runFiles) {
        const p = path.join(FTL_PATH, f);
        if (fs.existsSync(p)) { activeFile = p; break; }
    }
    if (!activeFile) return settings.activeState;

    const activeHash = getFileHash(activeFile);
    const states = fs.readdirSync(STATES_PATH).filter(f => {
        try { return fs.statSync(path.join(STATES_PATH, f)).isDirectory(); } catch (e) { return false; }
    });

    for (const state of states) {
        const stateFiles = fs.readdirSync(path.join(STATES_PATH, state));
        for (const sf of stateFiles) {
            if (getFileHash(path.join(STATES_PATH, state, sf)) === activeHash) return state;
        }
    }
    return settings.activeState;
});

ipcMain.handle('delete-state', async (event, name) => {
    const stateDir = path.join(STATES_PATH, name);
    if (fs.existsSync(stateDir)) fs.rmSync(stateDir, { recursive: true, force: true });
    return true;
});

ipcMain.handle('open-save-folder', async () => {
    shell.openPath(FTL_PATH);
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

ipcMain.handle('get-current-states-path', async () => {
    return STATES_PATH;
});

ipcMain.handle('is-ftl-running', async () => {
    const { exec } = require('child_process');
    const command = process.platform === 'win32' ? 'tasklist /FI "IMAGENAME eq FTLGame.exe" /NH' : 'pgrep FTLGame';
    return new Promise((resolve) => {
        exec(command, (err, stdout) => { resolve(stdout && stdout.toLowerCase().includes('ftlgame')); });
    });
});

ipcMain.handle('get-settings', async () => {
    return settings;
});

ipcMain.handle('update-settings', async (event, newSettings) => {
    settings = { ...settings, ...newSettings };
    fs.writeFileSync(settingsPath, JSON.stringify(settings));
    return settings;
});
