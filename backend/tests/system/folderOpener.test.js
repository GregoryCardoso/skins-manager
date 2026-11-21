const { openFolder, canOpenFolder } = require('../../src/services/system/folderOpener');

const fakeExec = (err) => (cmd, args, opts, cb) => {
  cb(err);
  return { on() {} };
};

describe('folderOpener', () => {
  test('canOpenFolder só no Windows', () => {
    expect(canOpenFolder('win32')).toBe(true);
    expect(canOpenFolder('linux')).toBe(false);
  });
  test('usa explorer.exe com o caminho como argumento, sem shell', async () => {
    const execFileFn = jest.fn(fakeExec(null));
    await openFolder('C:\\x y', { execFileFn });
    expect(execFileFn.mock.calls[0][0]).toBe('explorer.exe');
    expect(execFileFn.mock.calls[0][1]).toEqual(['C:\\x y']);
    expect(execFileFn.mock.calls[0][2].shell).toBeUndefined();
  });
  test('código de saída 1 do explorer não é falha; erro de spawn é', async () => {
    const exit1 = Object.assign(new Error('exit'), { code: 1 });
    await expect(openFolder('d', { execFileFn: fakeExec(exit1) })).resolves.toBeUndefined();
    const enoent = Object.assign(new Error('nope'), { code: 'ENOENT' });
    await expect(openFolder('d', { execFileFn: fakeExec(enoent) })).rejects.toThrow('nope');
  });
});

describe('folderOpener - complementos', () => {
  test('erro síncrono do execFile vira rejeição', async () => {
    await expect(openFolder('d', { execFileFn: () => { throw new Error('sync'); } })).rejects.toThrow('sync');
  });
  test("evento 'error' do processo filho (spawn falhou) rejeita", async () => {
    const execFileFn = () => ({ on: (ev, cb) => { if (ev === 'error') setImmediate(() => cb(new Error('spawn EACCES'))); } });
    await expect(openFolder('d', { execFileFn })).rejects.toThrow('spawn EACCES');
  });
  test('resolve uma única vez mesmo com callback e evento', async () => {
    let errCb;
    const execFileFn = (c, a, o, cb) => { setImmediate(() => cb(null)); return { on: (ev, f) => { errCb = f; } }; };
    await expect(openFolder('d', { execFileFn })).resolves.toBeUndefined();
    expect(() => errCb(new Error('tarde'))).not.toThrow();
  });
  test('o caminho vai como um único argumento, mesmo com metacaracteres de shell', async () => {
    const execFileFn = jest.fn(fakeExec(null));
    const nasty = 'C:\a & calc.exe | "x" %PATH% ^';
    await openFolder(nasty, { execFileFn });
    expect(execFileFn.mock.calls[0][1]).toEqual([nasty]);
  });
  test('canOpenFolder() padrão acompanha a plataforma real', () => {
    expect(canOpenFolder()).toBe(process.platform === 'win32');
  });
});
