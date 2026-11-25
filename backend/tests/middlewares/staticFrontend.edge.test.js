const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const request = require('supertest');
const { createApp } = require('../../src/app');

let root;
let dir;
let noIndexDir;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-static-edge-'));
  dir = path.join(root, 'out');
  noIndexDir = path.join(root, 'noindex');
  fs.mkdirSync(dir);
  fs.mkdirSync(noIndexDir);
  fs.writeFileSync(path.join(noIndexDir, 'other.txt'), 'x');
  fs.writeFileSync(path.join(root, 'secret.txt'), 'SEGREDO-FORA-DA-PASTA');
  fs.writeFileSync(path.join(dir, 'index.html'), '<html>home</html>');
  fs.writeFileSync(path.join(dir, '.env'), 'OCULTO=1');
  fs.mkdirSync(path.join(dir, '.hidden'));
  fs.writeFileSync(path.join(dir, '.hidden', 'a.txt'), 'OCULTO-DIR');
  fs.mkdirSync(path.join(dir, 'sales'));
  fs.writeFileSync(path.join(dir, 'sales', 'index.html'), '<html>vendas</html>');
  fs.writeFileSync(path.join(dir, '404.html'), '<html>nao achei</html>');
  fs.mkdirSync(path.join(dir, '_next', 'static'), { recursive: true });
  fs.writeFileSync(path.join(dir, '_next', 'static', 'x.js'), 'console.log(1)');
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const app = () => createApp({ staticDir: dir });

// Envia o caminho cru (sem normalização do cliente).
function rawGet(application, rawPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const server = application.listen(0, '127.0.0.1', () => {
      const req = http.request({ host: '127.0.0.1', port: server.address().port, path: rawPath, method }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => server.close(() => resolve({ status: res.statusCode, body, headers: res.headers })));
      });
      req.on('error', (e) => server.close(() => reject(e)));
      req.end();
    });
  });
}

describe('travessia de caminho', () => {
  const attempts = [
    '/../secret.txt',
    '/..%2fsecret.txt',
    '/..%2Fsecret.txt',
    '/%2e%2e/secret.txt',
    '/%2e%2e%2fsecret.txt',
    '/..\\secret.txt',
    '/..%5csecret.txt',
    '/..%5Csecret.txt',
    '/%2e%2e%5csecret.txt',
    '/sales/..%5c..%5csecret.txt',
    '/_next/static/..%2f..%2f..%2fsecret.txt',
    '/%00',
    '/..%00/secret.txt',
    '/%c0%ae%c0%ae/secret.txt',
    '/%',
  ];
  test.each(attempts)('%s não vaza arquivo fora da pasta', async (p) => {
    const res = await rawGet(app(), p);
    expect(res.body).not.toContain('SEGREDO-FORA-DA-PASTA');
    expect(res.status).toBeLessThan(500);
  });
});

describe('métodos', () => {
  test('HEAD / devolve 200 sem corpo e com no-cache', async () => {
    const res = await request(app()).head('/');
    expect(res.status).toBe(200);
    expect(res.text === undefined || res.text === '').toBe(true);
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  test('HEAD em arquivo estático _next', async () => {
    const res = await request(app()).head('/_next/static/x.js');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('immutable');
  });

  test('HEAD em caminho desconhecido é 404', async () => {
    const res = await request(app()).head('/nao-existe');
    expect(res.status).toBe(404);
  });

  test.each(['post', 'put', 'delete', 'patch'])('%s fora de /api não serve arquivo', async (method) => {
    for (const p of ['/', '/sales/', '/index.html', '/_next/static/x.js']) {
      const res = await request(app())[method](p);
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });

  test('OPTIONS fora de /api não devolve conteúdo de arquivo', async () => {
    const res = await request(app()).options('/index.html');
    expect(res.text || '').not.toContain('home');
  });
});

describe('/api continua JSON', () => {
  test.each(['/api', '/api/', '/api/nao-existe', '/api/items/abc/xyz/nope', '/api/index.html'])(
    'GET %s -> 404 JSON NOT_FOUND',
    async (p) => {
      const res = await request(app()).get(p);
      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  );

  test('HEAD /api/nao-existe não cai no 404.html', async () => {
    const res = await request(app()).head('/api/nao-existe');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  test('/apix (prefixo parecido) é tratado como frontend', async () => {
    const res = await request(app()).get('/apix');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });
});

describe('redirecionamento de pasta', () => {
  test('/sales -> 301 /sales/ preservando query string', async () => {
    const res = await request(app()).get('/sales?x=1&y=a%20b');
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/sales/?x=1&y=a%20b');
  });

  test('/sales/?x=1 serve a página', async () => {
    const res = await request(app()).get('/sales/?x=1');
    expect(res.status).toBe(200);
    expect(res.text).toContain('vendas');
  });

  test('não redireciona para fora do site (//evil.com)', async () => {
    const res = await rawGet(app(), '//evil.com/');
    if (res.headers.location) expect(res.headers.location).not.toMatch(/^\/\/evil|^https?:\/\/evil/);
  });
});

describe('cabeçalhos de cache', () => {
  test('404.html servido no 404 tem no-cache', async () => {
    const res = await request(app()).get('/nao-existe');
    expect(res.status).toBe(404);
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  test('GET /404.html direto: no-cache', async () => {
    const res = await request(app()).get('/404.html');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  test('/sales/ e /index.html: no-cache', async () => {
    expect((await request(app()).get('/sales/')).headers['cache-control']).toBe('no-cache');
    expect((await request(app()).get('/index.html')).headers['cache-control']).toBe('no-cache');
  });

  test('404 de /_next/static/inexistente não é immutable', async () => {
    const res = await request(app()).get('/_next/static/nao.js');
    expect(res.status).toBe(404);
    expect(res.headers['cache-control']).not.toContain('immutable');
  });
});

describe('503 e pastas inexistentes', () => {
  test('pasta sem index.html (com outros arquivos): 503', async () => {
    const a = createApp({ staticDir: noIndexDir });
    const res = await request(a).get('/other.txt');
    expect(res.status).toBe(503);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Interface not found');
  });

  test('pasta inexistente: 503 e não lança', async () => {
    const a = createApp({ staticDir: path.join(root, 'nao-existe') });
    expect((await request(a).get('/')).status).toBe(503);
    expect((await request(a).head('/')).status).toBe(503);
  });

  test('503 não afeta /api (inclusive 404 JSON) e POST fora de /api é NOT_FOUND', async () => {
    const a = createApp({ staticDir: path.join(root, 'nao-existe') });
    expect((await request(a).get('/api/health')).status).toBe(200);
    const nf = await request(a).get('/api/nao-existe');
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('NOT_FOUND');
    const post = await request(a).post('/');
    expect(post.status).toBe(404);
    expect(post.body.error.code).toBe('NOT_FOUND');
  });

  test('sem 404.html, caminho desconhecido cai no NOT_FOUND JSON', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-static-no404-'));
    try {
      fs.writeFileSync(path.join(d, 'index.html'), '<html>x</html>');
      const res = await request(createApp({ staticDir: d })).get('/nada');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });
});

describe('dotfiles', () => {
  test.each(['/.env', '/.hidden/a.txt', '/.hidden/', '/%2eenv', '/sales/../.env'])('%s não é servido', async (p) => {
    const res = await rawGet(app(), p);
    expect(res.body).not.toContain('OCULTO');
  });
});
