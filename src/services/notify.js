'use strict';

const config = require('../config/config');

let client = null;

function setClient(c) {
  client = c;
}

/**
 * DM every configured owner (OWNER_IDS and/or OWNER_ID — any number of ids).
 * Owners with closed DMs / unknown ids are skipped individually, so one bad
 * entry can never block the others, and a failure never reaches the caller.
 */
async function notifyOwner(embed) {
  if (!client) return;
  const owners = Array.isArray(config.ownerIds) ? config.ownerIds : [];
  await Promise.all(
    owners.map(async (ownerId) => {
      try {
        const user = await client.users.fetch(ownerId);
        await user.send({ embeds: [embed] });
      } catch {
        /* owner has DMs closed or the id is unknown — ignore */
      }
    })
  );
}

module.exports = { setClient, notifyOwner, notifyOwners: notifyOwner };
