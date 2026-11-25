const fs = require('fs');
const path = require('path');
const express = require('express');

const MISSING_UI_HTML = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Skins Manager</title></head>
<body style="font-family:sans-serif;max-width:40rem;margin:4rem auto">
<h1>Skins Manager</h1>
<section lang="pt-BR">
<p>A tela do app ainda não foi montada. Feche o app e abra o start-app.bat de novo. Se você mexe no código, rode "npm run build" na pasta do projeto.</p>
</section>
<section lang="en">
<p>The app screen has not been built yet. Close the app and open start-app.bat again. If you work on the code, run "npm run build" in the project folder.</p>
</section>
</body></html>`;

function setCacheHeaders(res, filePath) {
  const normalized = filePath.split(path.sep).join('/');
  if (normalized.includes('/_next/static/')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (/\.html?$/i.test(filePath)) {
    res.setHeader('Cache-Control', 'no-cache');
  }
}

// Serve o frontend exportado (D134). Registrado depois de /api; só GET/HEAD fora de /api.
function createStaticFrontend({ dir }) {
  const router = express.Router();
  const staticHandler = express.static(dir, {
    index: 'index.html',
    redirect: true,
    dotfiles: 'ignore',
    setHeaders: setCacheHeaders,
  });

  router.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path === '/api' || req.path.startsWith('/api/')) return next();

    if (!fs.existsSync(path.join(dir, 'index.html'))) {
      return res.status(503).type('html').send(MISSING_UI_HTML);
    }

    return staticHandler(req, res, (err) => {
      if (err) return next(err);
      const notFoundPage = path.join(dir, '404.html');
      if (!fs.existsSync(notFoundPage)) return next();
      res.status(404);
      res.setHeader('Cache-Control', 'no-cache');
      return res.sendFile(notFoundPage, (sendErr) => {
        if (sendErr && !res.headersSent) next(sendErr);
      });
    });
  });

  return router;
}

module.exports = { createStaticFrontend };
