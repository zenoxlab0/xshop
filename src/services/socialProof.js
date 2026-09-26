'use strict';

/**
 * Social-proof receipts — the data behind the shop panel's Vouches / Deals
 * tabs. Every `!vouch` / `!deal` (prefix or slash) that actually posts to its
 * channel inserts one row here, so the tabs can show real receipts, running
 * totals and the most-vouched members without scraping Discord history.
 */

const { db } = require('../database/db');

const KINDS = new Set(['vouch', 'deal']);

const insertStmt = db.prepare(
  'INSERT INTO social_proof (kind, target_id, actor_id, product) VALUES (?, ?, ?, ?)'
);
const byIdStmt = db.prepare('SELECT * FROM social_proof WHERE id = ?');
const removeStmt = db.prepare('DELETE FROM social_proof WHERE id = ?');
const listStmt = db.prepare('SELECT * FROM social_proof WHERE kind = ? ORDER BY id DESC LIMIT ?');
const countAllStmt = db.prepare('SELECT COUNT(*) c FROM social_proof WHERE kind = ?');
const countTargetStmt = db.prepare(
  'SELECT COUNT(*) c FROM social_proof WHERE kind = ? AND target_id = ?'
);
const countSinceStmt = db.prepare(
  "SELECT COUNT(*) c FROM social_proof WHERE kind = ? AND created_at >= datetime('now', ?)"
);
const topStmt = db.prepare(
  'SELECT target_id, COUNT(*) n FROM social_proof WHERE kind = ? ' +
    'GROUP BY target_id ORDER BY n DESC, MAX(id) DESC LIMIT ?'
);

/** sqlite UTC `YYYY-MM-DD HH:MM:SS` → unix seconds (Discord `<t:…>` ready). */
function epochOf(sqliteUtc) {
  const t = Date.parse(`${String(sqliteUtc || '').replace(' ', 'T')}Z`);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

function withEpoch(row) {
  return row ? { ...row, epoch: epochOf(row.created_at) } : row;
}

/** Insert one receipt and return it with the running totals attached. */
function recordProof(kind, targetId, actorId, product) {
  const k = KINDS.has(kind) ? kind : 'vouch';
  const target = String(targetId);
  const text = String(product || '').trim().slice(0, 120);
  const info = insertStmt.run(k, target, String(actorId), text);
  const row = withEpoch(byIdStmt.get(info.lastInsertRowid));
  return {
    ...row,
    totalAll: countAllStmt.get(k).c,
    totalForTarget: countTargetStmt.get(k, target).c,
  };
}

/** Drop a receipt (used when the channel post failed after recording). */
function removeProof(id) {
  removeStmt.run(id);
}

/** Newest receipts of a kind, oldest last — ready to render top to bottom. */
function listProofs(kind, limit = 8) {
  return listStmt.all(kind, limit).map(withEpoch).reverse();
}

function countProofs(kind) {
  return countAllStmt.get(kind).c;
}

/** Receipts of a kind posted in the last 7 days. */
function countProofsThisWeek(kind) {
  return countSinceStmt.get(kind, '-7 days').c;
}

/** Most vouched / most buying members: [{ target_id, n }] best first. */
function topTargets(kind, limit = 3) {
  return topStmt.all(kind, limit);
}

/** Everything a tab screen renders in one call. */
function stats(kind) {
  const latest = db
    .prepare('SELECT created_at FROM social_proof WHERE kind = ? ORDER BY id DESC LIMIT 1')
    .get(kind);
  return {
    total: countProofs(kind),
    week: countProofsThisWeek(kind),
    latestEpoch: latest ? epochOf(latest.created_at) : null,
    top: topTargets(kind, 3),
  };
}

module.exports = { recordProof, removeProof, listProofs, countProofs, countProofsThisWeek, topTargets, stats };
