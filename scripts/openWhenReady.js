// Abre o navegador padrão quando o backend responde em /api/health (D137). Usado pelo start-app.bat.
const { spawn } = require('child_process');
const { waitForHealth, resolvePort } = require('./startHelpers');

async function main() {
  const port = resolvePort();
  const url = `http://localhost:${port}`;
  const ready = await waitForHealth({ port });
  if (!ready) {
    console.error(`O Skins Manager não respondeu em 60 segundos. Confira as mensagens acima e abra ${url} manualmente.`);
    return;
  }
  // `start "" url` abre no navegador padrão do Windows.
  spawn('cmd', ['/c', 'start', '""', url], { stdio: 'ignore', windowsHide: true, detached: true }).unref();
}

main();
