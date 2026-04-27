import { defineConfig, type Plugin } from 'vite';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const LM_HEALTH_URL = 'http://localhost:1234/v1/models';
const LLAMA_BAT = 'C:\\llama\\start-server.bat';
const LM_STUDIO_EXE = join(homedir(), 'AppData', 'Local', 'Programs', 'LM Studio', 'LM Studio.exe');
const LMS_CLI = join(homedir(), '.lmstudio', 'bin', 'lms.exe');

async function isLmRunning(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(LM_HEALTH_URL, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForLm(maxMs: number, label: string): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 1500));
    if (await isLmRunning()) {
      console.log(`  ✓ LM-Server bereit (${label}, ${Math.round((Date.now() - start) / 1000)}s)\n`);
      return true;
    }
  }
  return false;
}

function spawnDetached(exe: string, args: string[]): boolean {
  if (!existsSync(exe)) return false;
  try {
    const proc = spawn(exe, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    proc.on('error', () => { /* ignore */ });
    proc.unref();
    return true;
  } catch {
    return false;
  }
}

function tryLmsServerStart(): boolean {
  if (!existsSync(LMS_CLI)) return false;
  try {
    const proc = spawn(LMS_CLI, ['server', 'start'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    proc.on('error', () => { /* ignore */ });
    proc.unref();
    return true;
  } catch {
    return false;
  }
}

function lmAutoStartPlugin(): Plugin {
  return {
    name: 'lm-autostart',
    apply: 'serve',
    async configureServer() {
      if (await isLmRunning()) {
        console.log('\n  ✓ LM-Server läuft bereits auf Port 1234\n');
        return;
      }
      console.log('\n  ⏳ LM-Server nicht erreichbar — versuche zu starten…');

      // Strategie 1: lms CLI (funktioniert nur wenn LM Studio App läuft)
      if (tryLmsServerStart()) {
        console.log('  → "lms server start" abgesetzt');
        if (await waitForLm(8_000, 'lms CLI')) return;
      }

      // Strategie 2: LM Studio App selbst starten (öffnet GUI), dann nochmal lms
      if (spawnDetached(LM_STUDIO_EXE, [])) {
        console.log('  → LM Studio.exe gestartet — warte bis App hochkommt…');
        await new Promise((r) => setTimeout(r, 5_000));
        tryLmsServerStart();
        if (await waitForLm(25_000, 'LM Studio App + lms')) return;
      }

      // Strategie 3: llama-server.exe Bat-Datei (alter Setup-Pfad)
      if (existsSync(LLAMA_BAT)) {
        console.log(`  → ${LLAMA_BAT} starten…`);
        spawn('cmd', ['/c', 'start', '""', LLAMA_BAT], {
          detached: true,
          stdio: 'ignore',
        }).unref();
        if (await waitForLm(30_000, 'llama-server')) return;
      }

      console.log('  ⚠ Konnte LM-Server nicht automatisch hochfahren.');
      console.log('     → LM Studio manuell öffnen, Modell laden, Server starten.\n');
    },
  };
}

export default defineConfig({
  plugins: [lmAutoStartPlugin()],
  server: {
    proxy: {
      '/v1': {
        target: 'http://localhost:1234',
        changeOrigin: true,
        ws: false,
      },
    },
  },
});
