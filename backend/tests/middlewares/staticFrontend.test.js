const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { createApp } = require('../../src/app');

let dir;
let emptyDir;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-static-'));
  emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-static-empty-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html>home</html>');
  fs.mkdirSync(path.join(dir, 'sales'));
  fs.writeFileSync(path.join(dir, 'sales', 'index.html'), '<html>vendas</html>');
  fs.writeFileSync(path.join(dir, '404.html'), '<html>nao achei</html>');
  fs.mkdirSync(path.join(dir, '_next', 'static'), { recursive: true });
  fs.writeFileSync(path.join(dir, '_next', 'static', 'x.js'), 'console.log(1)');
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(emptyDir, { recursive: true, force: true });
});

describe('staticFrontend', () => {
  const app = () => createApp({ staticDir: dir });

  test('/ e /sales/ servem HTML', async () => {
    const home = await request(app()).get('/');
    expect(home.status).toBe(200);
    expect(home.text).toContain('home');
    const sales = await request(app()).get('/sales/');
    expect(sales.status).toBe(200);
    expect(sales.text).toContain('vendas');
  });

  test('/sales redireciona para /sales/', async () => {
    const res = await request(app()).get('/sales');
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/sales/');
  });

  test('cache: _next/static immutable e HTML no-cache', async () => {
    const js = await request(app()).get('/_next/static/x.js');
    expect(js.status).toBe(200);
    expect(js.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const html = await request(app()).get('/');
    expect(html.headers['cache-control']).toBe('no-cache');
  });

  test('caminho desconhecido devolve 404.html com status 404', async () => {
    const res = await request(app()).get('/nao-existe');
    expect(res.status).toBe(404);
    expect(res.text).toContain('nao achei');
  });

  test('/api desconhecido continua JSON NOT_FOUND', async () => {
    const res = await request(app()).get('/api/nao-existe');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  test('POST fora de /api não é servido como arquivo', async () => {
    const res = await request(app()).post('/');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  test('travessia de caminho não vaza arquivos', async () => {
    const res = await request(app()).get('/..%2f..%2fpackage.json');
    expect(res.text).not.toContain('skins-manager');
  });

  test('sem index.html: 503 com mensagem em português e API intacta', async () => {
    const a = createApp({ staticDir: emptyDir });
    const res = await request(a).get('/');
    expect(res.status).toBe(503);
    expect(res.text).toContain('A tela do app ainda não foi montada');
    const health = await request(a).get('/api/health');
    expect(health.status).toBe(200);
  });

  test('/api/health intacto com interface', async () => {
    const res = await request(app()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('página sem interface (11.6, parada D)', () => {
  test('503 com pt-BR e en na mesma página, cada bloco com o seu lang, sem comandos antigos', async () => {
    const res = await request(createApp({ staticDir: emptyDir })).get('/');
    expect(res.status).toBe(503);
    expect(res.text).toContain('lang="pt-BR"');
    expect(res.text).toContain('<section lang="en">');
    expect(res.text).toContain('A tela do app ainda não foi montada');
    expect(res.text).toContain('The app screen has not been built yet');
    expect(res.text).toContain('start-app.bat');
    expect(res.text).not.toContain('npm start');
    expect(res.text).not.toContain('Interface not found');
  });
});
