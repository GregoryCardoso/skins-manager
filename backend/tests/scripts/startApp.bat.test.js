const fs = require('fs');
const path = require('path');

const bat = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'start-app.bat'), 'utf8');

describe('start-app.bat', () => {
  test('termina linhas em CRLF (sem LF solto)', () => {
    expect(bat).toMatch(/\r\n/);
    expect(bat.replace(/\r\n/g, '')).not.toMatch(/\n/);
  });

  test('vai para a pasta do .bat entre aspas e usa npm.cmd com call', () => {
    expect(bat).toContain('cd /d "%~dp0"');
    expect(bat).toMatch(/call npm\.cmd run serve/);
    expect(bat).not.toMatch(/^\s*npm /m);
  });

  test('checa Node ausente e versão menor que 20', () => {
    expect(bat).toMatch(/where node/);
    expect(bat).toMatch(/LSS 20/);
    expect(bat).toMatch(/pause/);
  });

  test('UTF-8 sem BOM e chcp 65001 (acentos no console)', () => {
    const raw = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'start-app.bat'));
    expect([raw[0], raw[1], raw[2]]).not.toEqual([0xef, 0xbb, 0xbf]);
    expect(bat.split('\r\n')[0]).toBe('@echo off');
    expect(bat).toMatch(/^chcp 65001 >nul$/m);
  });

  test('echo sem ")" ou "&" soltos (quebrariam blocos entre parênteses)', () => {
    const echoes = bat.split('\r\n').filter((l) => /^\s*echo\s/i.test(l));
    for (const line of echoes) expect(line).not.toMatch(/[^^][)&|<>]/);
  });

  test('primeira execução instala, build só quando precisa, navegador em segundo plano', () => {
    expect(bat).toMatch(/if not exist "frontend\\node_modules"/);
    expect(bat).toMatch(/call npm\.cmd run install:all/);
    expect(bat).toMatch(/startHelpers\.js" needs-build/);
    expect(bat).toMatch(/startHelpers\.js" running/);
    expect(bat).toMatch(/start "" \/b node "scripts\\openWhenReady\.js"/);
  });

  test('erro ao subir o servidor pausa a janela', () => {
    const after = bat.slice(bat.indexOf('call npm.cmd run serve'));
    expect(after).toMatch(/if errorlevel 1 \(/);
    expect(after).toMatch(/pause/);
  });
});
