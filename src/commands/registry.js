'use strict';

// Standalone registry module — command files may require this safely,
// avoiding circular dependencies with commands/index.js.
const registry = new Map();

module.exports = { registry };
