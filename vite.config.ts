import { defineConfig, type Plugin } from 'vite';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const LM_HEALTH_URL = 'http://localhost:1234/v1/models';
const LLAMA_BAT = 'C:\\llama\\start-server.bat';

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

function startLmStudioCli(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('lms', ['server', 'start'], {
      detached: true,
      stdio: 'ignore',
      shell: true,
      windowsHide: true,
    });
    let resolved = false;
    proc.on('error', () => {
      if (!resolved) { resolved = true; resolve(false); }
    });
    proc.on('exit', (code) => {
      if (!resolved) { resolved = true; resolve(code === 0); }
    });
    setTimeout(() => {
      if (!resolved) { resolved = true; resolve(true); }
    }, 3000);
    proc.unref();
  });
}

function startLlamaBat(): boolean {
  if (!existsSync(LLAMA_BAT)) return false;
  spawn('cmd', ['/c', 'start', '""', LLAMA_BAT], {
    detached: true,
    stdio: 'ignore',
    shell: false,
    windowsHide: false,
  }).unref();
  return true;
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

      const lmsOk = await startLmStudioCli();
      if (lmsOk) {
        console.log('  ✓ "lms server start" gestartet (LM Studio CLI)');
      } else if (startLlamaBat()) {
        console.log(`  ✓ ${LLAMA_BAT} gestartet`);
      } else {
        console.log('  ⚠ Konnte LM-Server nicht automatisch starten.');
        console.log('     → LM Studio öffnen und Server manuell starten,');
        console.log(`     → oder ${LLAMA_BAT} ausführen.\n`);
        return;
      }

      // Wait until reachable (max 30s)
      const start = Date.now();
      while (Date.now() - start < 30_000) {
        await new Promise((r) => setTimeout(r, 1000));
        if (await isLmRunning()) {
          console.log('  ✓ LM-Server bereit\n');
          return;
        }
      }
      console.log('  ⚠ Timeout — Server scheint nicht hochzukommen. Schau ins LM-Studio-Fenster.\n');
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
