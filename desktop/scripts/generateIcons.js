'use strict';

// Gera os ícones do app a partir de build/logo.svg e build/logo-small.svg (12.10, P1).
// Rode só quando a logo mudar: npm --prefix desktop run icons. As saídas ficam versionadas.
// O .ico é montado aqui mesmo (ICONDIR + entradas), sem outra dependência.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DESKTOP_DIR = path.join(__dirname, '..');
const FRONTEND_PUBLIC = path.join(DESKTOP_DIR, '..', 'frontend', 'public');

const SOURCES = {
  logo: path.join(DESKTOP_DIR, 'build', 'logo.svg'),
  small: path.join(DESKTOP_DIR, 'build', 'logo-small.svg'),
};
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const FAVICON_SIZES = [16, 32, 48];
const SMALL_MAX = 32; // até este tamanho usa a variante sem o fuzil
const DIB_MAX = 48; // até este tamanho a entrada do .ico é DIB 32 bits; acima, PNG embutido

const OUTPUTS = {
  png1024: path.join(DESKTOP_DIR, 'build', 'icon.png'),
  png512: path.join(DESKTOP_DIR, 'build', 'icon-512.png'),
  png256: path.join(DESKTOP_DIR, 'build', 'icon-256.png'),
  ico: path.join(DESKTOP_DIR, 'build', 'icon.ico'),
  windowPng: path.join(DESKTOP_DIR, 'src', 'assets', 'icon.png'),
  favicon: path.join(FRONTEND_PUBLIC, 'favicon.ico'),
  iconSvg: path.join(FRONTEND_PUBLIC, 'icon.svg'),
};
const MANIFEST_PATH = path.join(DESKTOP_DIR, 'build', 'icons.manifest.json');

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
// Arquivos de texto (SVG, JSON) podem ganhar CRLF no checkout do Windows (core.autocrlf): o hash ignora a quebra de linha.
const TEXT_EXTENSIONS = new Set(['.svg', '.json', '.md']);
const contentHash = (file, buffer = fs.readFileSync(file)) =>
  TEXT_EXTENSIONS.has(path.extname(file).toLowerCase()) ? sha256(buffer.toString('utf8').replace(/\r\n/g, '\n')) : sha256(buffer);
const relPath = (file) => path.relative(DESKTOP_DIR, file).split(path.sep).join('/');

function renderPng(svgText, size) {
  const { Resvg } = require('@resvg/resvg-js');
  return Buffer.from(new Resvg(svgText, { fitTo: { mode: 'width', value: size } }).render().asPng());
}

// PNG (RGBA 8 bits, não entrelaçado) -> pixels RGBA. Só lê o que o resvg gera.
function decodePngRgba(png) {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (png[24] !== 8 || png[25] !== 6 || png[28] !== 0) throw new Error('PNG inesperado (esperado RGBA 8 bits).');
  const chunks = [];
  for (let pos = 8; pos < png.length; ) {
    const len = png.readUInt32BE(pos);
    if (png.toString('ascii', pos + 4, pos + 8) === 'IDAT') chunks.push(png.subarray(pos + 8, pos + 8 + len));
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? out[y * stride + x - 4] : 0;
      const up = y > 0 ? out[(y - 1) * stride + x] : 0;
      const upLeft = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      out[y * stride + x] = value & 255;
    }
  }
  return { width, height, rgba: out };
}

// Entrada DIB 32 bits BGRA (de baixo para cima) + máscara AND zerada (o alfa já define a transparência).
function dibFromPng(png) {
  const { width, height, rgba } = decodePngRgba(png);
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(width, 4);
  header.writeInt32LE(height * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = (y * width + x) * 4;
      const dst = ((height - 1 - y) * width + x) * 4;
      pixels[dst] = rgba[src + 2];
      pixels[dst + 1] = rgba[src + 1];
      pixels[dst + 2] = rgba[src];
      pixels[dst + 3] = rgba[src + 3];
    }
  }
  const maskStride = Math.ceil(width / 32) * 4;
  return Buffer.concat([header, pixels, Buffer.alloc(maskStride * height)]);
}

// images: [{ size, png }] -> conteúdo do .ico
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  const bodies = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const body = size <= DIB_MAX ? dibFromPng(png) : png;
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(body.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    bodies.push(body);
    offset += body.length;
  }
  return Buffer.concat([header, ...entries, ...bodies]);
}

function generate() {
  const logo = fs.readFileSync(SOURCES.logo, 'utf8');
  const small = fs.readFileSync(SOURCES.small, 'utf8');
  const pngFor = (size) => renderPng(size <= SMALL_MAX ? small : logo, size);
  return {
    png1024: renderPng(logo, 1024),
    png512: renderPng(logo, 512),
    png256: renderPng(logo, 256),
    ico: buildIco(ICO_SIZES.map((size) => ({ size, png: pngFor(size) }))),
    windowPng: renderPng(logo, 256),
    favicon: buildIco(FAVICON_SIZES.map((size) => ({ size, png: pngFor(size) }))),
    iconSvg: Buffer.from(logo, 'utf8'),
  };
}

function main() {
  const files = generate();
  const manifest = { generator: '@resvg/resvg-js', sources: {}, outputs: {} };
  for (const file of Object.values(SOURCES)) manifest.sources[relPath(file)] = contentHash(file);
  for (const [key, buffer] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(OUTPUTS[key]), { recursive: true });
    fs.writeFileSync(OUTPUTS[key], buffer);
    manifest.outputs[relPath(OUTPUTS[key])] = contentHash(OUTPUTS[key], buffer);
    console.log(`${relPath(OUTPUTS[key])} (${buffer.length} bytes)`);
  }
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { buildIco, decodePngRgba, sha256, contentHash, relPath, SOURCES, OUTPUTS, MANIFEST_PATH, ICO_SIZES, FAVICON_SIZES, DESKTOP_DIR };
