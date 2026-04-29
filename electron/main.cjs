const { app, BrowserWindow, shell, dialog, Notification } = require('electron');
const path = require('node:path');

const isDev = process.env.ELECTRON_DEV === '1' || !app.isPackaged;

// Auto-Update via electron-updater (nur in Production)
let autoUpdater = null;
if (!isDev) {
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (e) {
    console.warn('electron-updater nicht verfügbar:', e.message);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'Valdermoor',
    backgroundColor: '#0d0d0d',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // file:// Origin wäre sonst 'null' und CORS würde alle externen
      // API-Calls (Groq, Pollinations, EmailJS, Bilder) blockieren.
      // Sicher hier weil wir keine Untrusted-Inhalte ausführen.
      webSecurity: false,
    },
  });

  // Externe Links (Pollinations-Bilder etc.) nicht im Electron-Fenster, sondern
  // im normalen Browser des Users öffnen.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Auto-Update-Check 4 Sek nach Start (nicht beim ersten Render-Race)
  if (autoUpdater) {
    setTimeout(() => {
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;

      autoUpdater.on('update-available', (info) => {
        console.log('Update verfügbar:', info.version);
        new Notification({
          title: 'Valdermoor Update',
          body: `Version ${info.version} wird im Hintergrund geladen…`,
        }).show();
      });

      autoUpdater.on('update-downloaded', async (info) => {
        const result = await dialog.showMessageBox({
          type: 'info',
          buttons: ['Jetzt neu starten', 'Beim nächsten Beenden'],
          defaultId: 0,
          cancelId: 1,
          title: `Valdermoor v${info.version} bereit`,
          message: `Eine neue Version wurde heruntergeladen.`,
          detail: `Klick "Jetzt neu starten" — die App startet kurz neu, dein Spielstand bleibt erhalten.\n\nOder klick "Beim nächsten Beenden" — Update wird beim nächsten Schließen automatisch installiert.`,
        });
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });

      autoUpdater.on('error', (err) => {
        console.warn('AutoUpdater-Error:', err?.message ?? err);
      });

      autoUpdater.checkForUpdates().catch((err) => {
        console.warn('checkForUpdates fehlgeschlagen:', err?.message ?? err);
      });
    }, 4000);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
