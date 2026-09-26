'use strict';

const buckets = new Map();

/**
 * Simple in-memory cooldown. Returns the remaining ms if the action is on
 * cooldown, or 0 if it went through (and the cooldown started).
 */
function onCooldown(key, ms) {
  const now = Date.now();
  const last = buckets.get(key) || 0;
  if (now - last < ms) return ms - (now - last);
  buckets.set(key, now);
  return 0;
}

module.exports = { onCooldown };
