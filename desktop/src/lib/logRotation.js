'use strict';

// Log com rotação por tamanho (D178): 1 MB x 3 arquivos (atual, .1 e .2). Sem dependências.
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 1024 * 1024;
const KEEP = 3;

function rotatedName(filePath, index) {
  const { dir, name, ext } = path.parse(filePath);
  return path.join(dir, `${name}.${index}${ext}`);
}

// Desloca main.log -> main.1.log -> main.2.log; o mais antigo é apagado.
function rotate(filePath, { keep = KEEP, fsImpl = fs } = {}) {
  if (keep > 1) fsImpl.rmSync(rotatedName(filePath, keep - 1), { force: true });
  for (let index = keep - 2; index >= 1; index -= 1) {
    const from = rotatedName(filePath, index);
    if (fsImpl.existsSync(from)) fsImpl.renameSync(from, rotatedName(filePath, index + 1));
  }
  if (fsImpl.existsSync(filePath)) {
    if (keep > 1) fsImpl.renameSync(filePath, rotatedName(filePath, 1));
    else fsImpl.rmSync(filePath, { force: true });
  }
}

// Pura: precisa girar antes de gravar `incomingBytes`?
function shouldRotate(currentSize, incomingBytes, maxBytes = MAX_BYTES) {
  return currentSize > 0 && currentSize + incomingBytes > maxBytes;
}

function createRotatingLog(filePath, { maxBytes = MAX_BYTES, keep = KEEP, fsImpl = fs } = {}) {
  fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
  let size = 0;
  try {
    size = fsImpl.statSync(filePath).size;
  } catch (err) {
    size = 0;
  }
  return {
    filePath,
    write(text) {
      const data = Buffer.from(String(text), 'utf8');
      try {
        if (shouldRotate(size, data.length, maxBytes)) {
          rotate(filePath, { keep, fsImpl });
          size = 0;
        }
        fsImpl.appendFileSync(filePath, data);
        size += data.length;
      } catch (err) {
        // log nunca derruba o app
      }
    },
  };
}

module.exports = { createRotatingLog, rotate, rotatedName, shouldRotate, MAX_BYTES, KEEP };
