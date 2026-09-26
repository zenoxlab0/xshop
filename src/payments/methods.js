'use strict';

const { db } = require('../database/db');

const listAll = () => db.prepare('SELECT * FROM payment_methods ORDER BY position, id').all();

const listActive = () =>
  db.prepare("SELECT * FROM payment_methods WHERE status = 'active' ORDER BY position, id").all();

const get = (key) => db.prepare('SELECT * FROM payment_methods WHERE key = ?').get(key);

function cfg(method) {
  try {
    const c = JSON.parse(method?.config || '{}');
    return c && typeof c === 'object' ? c : {};
  } catch {
    return {};
  }
}

/** A method is customer-selectable once it has at least one configured field. */
function isConfigured(method) {
  const c = cfg(method);
  return Object.values(c).some((v) => v !== undefined && v !== null && String(v).trim() !== '');
}

function upsert(key, label, emoji) {
  db.prepare(
    `INSERT INTO payment_methods (key, label, emoji) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET label = excluded.label, emoji = excluded.emoji`
  ).run(key, label, emoji || '💳');
}

function setFields(key, fields) {
  const method = get(key);
  if (!method) return false;
  const merged = { ...cfg(method), ...fields };
  db.prepare("UPDATE payment_methods SET config = ? WHERE key = ?").run(JSON.stringify(merged), key);
  return true;
}

function setStatus(key, status) {
  db.prepare('UPDATE payment_methods SET status = ? WHERE key = ?').run(status, key);
}

function remove(key) {
  db.prepare('DELETE FROM payment_methods WHERE key = ?').run(key);
}

module.exports = { listAll, listActive, get, cfg, isConfigured, upsert, setFields, setStatus, remove };
