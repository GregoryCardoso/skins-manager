// Utilitários de mapeamento camelCase <-> snake_case. Sem regra de negócio.
const { ValidationError } = require('../errors/AppError');
const { getDb } = require('../config/database');

function toSnake(name) {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function toCamel(name) {
  return name.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function mapRow(row, booleanFields = []) {
  if (!row) return null;
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    const camel = toCamel(key);
    out[camel] = booleanFields.includes(camel) ? value === 1 : value;
  }
  return out;
}

function toDbValue(value) {
  if (value === true) return 1;
  if (value === false) return 0;
  return value;
}

// Retorna { columns: [snake...], values: [...] } apenas com as chaves permitidas e definidas.
function pickColumns(data, allowedFields) {
  data = data ?? {};
  for (const key of Object.keys(data)) {
    if (data[key] !== undefined && !allowedFields.includes(key)) {
      throw new ValidationError(`Campo desconhecido: ${key}`, 'UNKNOWN_FIELD');
    }
  }
  const columns = [];
  const values = [];
  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      columns.push(toSnake(field));
      values.push(toDbValue(data[field]));
    }
  }
  return { columns, values };
}

function insertRow(db, table, data, allowedFields, extra = {}) {
  const { columns, values } = pickColumns(data, allowedFields);
  for (const [col, val] of Object.entries(extra)) {
    columns.push(col);
    values.push(val);
  }
  const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
  return db.prepare(sql).run(...values).lastInsertRowid;
}

function updateRow(db, table, id, data, allowedFields, extra = {}) {
  const { columns, values } = pickColumns(data, allowedFields);
  for (const [col, val] of Object.entries(extra)) {
    columns.push(col);
    values.push(val);
  }
  const sql = `UPDATE ${table} SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`;
  return db.prepare(sql).run(...values, id).changes;
}

// Executa `fn` numa transação: se lançar, desfaz tudo.
function runInTransaction(fn) {
  return getDb().transaction(fn)();
}

module.exports = { runInTransaction, mapRow, insertRow, updateRow, toSnake, toCamel };
