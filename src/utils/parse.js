'use strict';

/** Split "!cmd a | b | c" into ['a', 'b', 'c'] (trimmed). */
function pipeArgs(rest) {
  return rest.split('|').map((s) => s.trim());
}

/**
 * Parse "!cmd 5 name=Boost price=199 status=hidden"
 * into { id: '5', values: { name: 'Boost', price: '199', status: 'hidden' } }.
 */
function kvArgs(rest) {
  const parts = rest.trim().split(/\s+/).filter(Boolean);
  const id = parts.shift() ?? '';
  const values = {};
  for (const part of parts) {
    const i = part.indexOf('=');
    if (i > 0) values[part.slice(0, i).toLowerCase()] = part.slice(i + 1).trim();
  }
  return { id, values };
}

function toNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

function toInt(value, fallback = null) {
  const n = toNumber(value, null);
  return n === null ? fallback : Math.trunc(n);
}

module.exports = { pipeArgs, kvArgs, toNumber, toInt };
