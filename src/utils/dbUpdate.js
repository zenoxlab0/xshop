'use strict';

const { db } = require('../database/db');

/**
 * Apply key=value edits to a row using a whitelist column map.
 * Only columns present in `map` ever reach the SQL statement.
 * Returns the number of affected rows (0 when nothing matched).
 */
function updateRow(table, id, values, map) {
  const sets = [];
  const params = {};
  for (const [key, value] of Object.entries(values)) {
    const col = map[key];
    if (!col || value === undefined || value === '') continue;
    sets.push(`${col} = @${col}`);
    params[col] = value;
  }
  if (!sets.length) return 0;
  const info = db
    .prepare(`UPDATE ${table} SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = @id`)
    .run({ ...params, id });
  return info.changes;
}

module.exports = { updateRow };
