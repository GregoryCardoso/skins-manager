'use strict';

// 12.10: ícones gerados (build/icon.*, favicon, ícone da janela) e manifesto com sha256.
// Se este teste falhar depois de mexer na logo: npm --prefix desktop run icons
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { sha256, contentHash, relPath, SOURCES, OUTPUTS, MANIFEST_PATH, ICO_SIZES, FAVICON_SIZES, DESKTOP_DIR } = require('../scripts/generateIcons');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const read = (file) => fs.readFileSync(file);

function pngSize(buffer) {
  expect(buffer.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  expect(buffer.toString('ascii', 12, 16)).toBe('IHDR');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function parseIco(buffer) {
  expect(buffer.readUInt16LE(0)).toBe(0);
  expect(buffer.readUInt16LE(2)).toBe(1);
  const count = buffer.readUInt16LE(4);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    const base = 6 + i * 16;
    const size = buffer[base] === 0 ? 256 : buffer[base];
    const bytes = buffer.readUInt32LE(base + 8);
    const offset = buffer.readUInt32LE(base + 12);
    expect(offset + bytes).toBeLessThanOrEqual(buffer.length);
    entries.push({ size, bits: buffer.readUInt16LE(base + 6), data: buffer.subarray(offset, offset + bytes) });
  }
  return entries;
}

describe('PNGs gerados', () => {
  test.each([
    ['png1024', 1024],
    ['png512', 512],
    ['png256', 256],
    ['windowPng', 256],
  ])('%s tem %i x %i', (key, size) => {
    expect(pngSize(read(OUTPUTS[key]))).toEqual({ width: size, height: size });
  });
});

describe('icon.ico', () => {
  const entries = parseIco(read(OUTPUTS.ico));

  test('tem os 7 tamanhos', () => {
    expect(entries.map((e) => e.size)).toEqual(ICO_SIZES);
    expect(ICO_SIZES).toEqual([16, 24, 32, 48, 64, 128, 256]);
    expect(entries.every((e) => e.bits === 32)).toBe(true);
  });

  test('64 a 256 são PNG embutido', () => {
    for (const entry of entries.filter((e) => e.size >= 64)) {
      expect(pngSize(entry.data)).toEqual({ width: entry.size, height: entry.size });
    }
  });

  test('16 a 48 são DIB 32 bits (BITMAPINFOHEADER, altura dobrada, com máscara AND)', () => {
    for (const entry of entries.filter((e) => e.size <= 48)) {
      const d = entry.data;
      expect(d.readUInt32LE(0)).toBe(40);
      expect(d.readInt32LE(4)).toBe(entry.size);
      expect(d.readInt32LE(8)).toBe(entry.size * 2);
      expect(d.readUInt16LE(14)).toBe(32);
      const maskBytes = Math.ceil(entry.size / 32) * 4 * entry.size;
      expect(d.length).toBe(40 + entry.size * entry.size * 4 + maskBytes);
    }
  });

  test('o cantinho do ícone é transparente e o centro é opaco (alfa dos DIBs)', () => {
    const e32 = entries.find((e) => e.size === 32);
    const alphaAt = (x, yFromTop) => e32.data[40 + ((31 - yFromTop) * 32 + x) * 4 + 3];
    expect(alphaAt(0, 0)).toBe(0);
    expect(alphaAt(16, 16)).toBe(255);
  });
});

describe('favicon.ico e icon.svg do frontend', () => {
  test('favicon com 16, 32 e 48', () => {
    expect(parseIco(read(OUTPUTS.favicon)).map((e) => e.size)).toEqual(FAVICON_SIZES);
    expect(FAVICON_SIZES).toEqual([16, 32, 48]);
  });

  test('icon.svg é a logo completa', () => {
    expect(read(OUTPUTS.iconSvg).equals(read(SOURCES.logo))).toBe(true);
  });

  test('o layout do frontend aponta para os dois arquivos', () => {
    const layout = fs.readFileSync(path.join(DESKTOP_DIR, '..', 'frontend', 'src', 'app', 'layout.tsx'), 'utf8');
    expect(layout).toContain('/favicon.ico');
    expect(layout).toContain('/icon.svg');
  });
});

describe('manifesto', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

  test('sha256 das fontes confere (logo mudou: rode npm --prefix desktop run icons)', () => {
    expect(Object.keys(manifest.sources).sort()).toEqual(Object.values(SOURCES).map(relPath).sort());
    for (const file of Object.values(SOURCES)) expect(manifest.sources[relPath(file)]).toBe(contentHash(file));
  });

  test('sha256 das saídas confere (saída desatualizada: rode npm --prefix desktop run icons)', () => {
    expect(Object.keys(manifest.outputs).sort()).toEqual(Object.values(OUTPUTS).map(relPath).sort());
    for (const file of Object.values(OUTPUTS)) expect(manifest.outputs[relPath(file)]).toBe(contentHash(file));
  });
});

describe('electron-builder usa o icon.ico', () => {
  const cfg = yaml.load(fs.readFileSync(path.join(DESKTOP_DIR, 'electron-builder.yml'), 'utf8'));

  test('executável, instalador, desinstalador e cabeçalho', () => {
    expect(cfg.win.icon).toBe('build/icon.ico');
    expect(cfg.nsis.installerIcon).toBe('build/icon.ico');
    expect(cfg.nsis.uninstallerIcon).toBe('build/icon.ico');
    expect(cfg.nsis.installerHeaderIcon).toBe('build/icon.ico');
    expect(fs.existsSync(path.join(DESKTOP_DIR, cfg.win.icon))).toBe(true);
  });

  test('o ícone da janela (src/assets) entra no asar', () => {
    expect(cfg.files).toContain('src/**/*');
  });

  test('@resvg/resvg-js em versão exata e script icons', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP_DIR, 'package.json'), 'utf8'));
    expect(pkg.devDependencies['@resvg/resvg-js']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.scripts.icons).toBe('node scripts/generateIcons.js');
  });
});
