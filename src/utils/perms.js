'use strict';

const { PermissionFlagsBits } = require('discord.js');
const config = require('../config/config');

/** Any owner (OWNER_IDS / OWNER_ID), Administrators, or the optional ADMIN_ROLE_ID. */
function isAdmin(member) {
  if (!member) return false;
  if (Array.isArray(config.ownerIds) && config.ownerIds.includes(member.id)) return true;
  if (config.adminRoleId && member.roles?.cache?.has(config.adminRoleId)) return true;
  try {
    return member.permissions?.has?.(PermissionFlagsBits.Administrator) ?? false;
  } catch {
    return false;
  }
}

/** True when `userId` is one of the configured owners (OWNER_IDS / OWNER_ID). */
function isOwner(userId) {
  const id = String(userId || '');
  return Boolean(id) && Array.isArray(config.ownerIds) && config.ownerIds.includes(id);
}

/** Staff = STAFF_ROLE_ID (admins always pass). */
function isStaff(member) {
  if (!member) return false;
  if (isAdmin(member)) return true;
  return Boolean(config.staffRoleId && member.roles?.cache?.has(config.staffRoleId));
}

/**
 * Staff check for component/modal interactions that ALSO works in DMs, where
 * `interaction.member` is null but owners must still be able to verify orders
 * from the review panel they received in their DMs.
 */
function canStaffAct(interaction) {
  if (!interaction) return false;
  return isStaff(interaction.member) || isOwner(interaction.user?.id);
}

module.exports = { isAdmin, isStaff, isOwner, canStaffAct };
