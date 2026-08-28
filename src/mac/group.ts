import { execFileSync } from 'node:child_process';
import { resolveGroup } from '../config';
import {
  MIN_GID,
  NAME_PATTERN,
  dsclExists,
  listIds,
  nextFreeId,
  readNumericAttr,
  sudoDscl,
} from './dscl';

export interface CreateGroupResult {
  created: boolean;
  gid: number;
}

export interface RemoveGroupResult {
  groupRemoved: boolean;
}

// Read a group's PrimaryGroupID, throwing if the record has none.
export function readPrimaryGroupId(groupName: string): number {
  const out = execFileSync(
    'dscl',
    ['.', '-read', `/Groups/${groupName}`, 'PrimaryGroupID'],
    { encoding: 'utf8' },
  );
  const match = out.match(/PrimaryGroupID:\s*(\d+)/);
  if (!match) {
    throw new Error(`Could not read PrimaryGroupID for group ${groupName}`);
  }
  return Number.parseInt(match[1], 10);
}

// The current GroupMembership set for a group (empty if the record is missing).
export function getGroupMembers(groupName: string): Set<string> {
  try {
    const out = execFileSync(
      'dscl',
      ['.', '-read', `/Groups/${groupName}`, 'GroupMembership'],
      { encoding: 'utf8' },
    );
    const match = out.match(/GroupMembership:\s*(.+)/);
    if (!match) return new Set();
    return new Set(match[1].trim().split(/\s+/));
  } catch {
    return new Set();
  }
}

// Add `member` to a group's GroupMembership, skipping if already present.
export function appendGroupMember(groupName: string, member: string): void {
  if (getGroupMembers(groupName).has(member)) return;
  sudoDscl(['-append', `/Groups/${groupName}`, 'GroupMembership', member]);
}

/**
 * Create the sandbox group in Directory Services if it does not already exist.
 *
 * @param groupName Group name. Defaults to resolveGroup() (process.env.AGENT_GROUP).
 * @returns Whether the group was created, plus its resolved PrimaryGroupID.
 */
export function createGroupIfNotExists(groupName?: string): CreateGroupResult {
  const resolvedGroup = resolveGroup(groupName);

  if (process.platform !== 'darwin') {
    throw new Error('The Agentrail sandbox group can only be created on macOS.');
  }
  if (!NAME_PATTERN.test(resolvedGroup)) {
    throw new Error(`Invalid group name: ${resolvedGroup}`);
  }

  // Check if group already exists
  if (dsclExists(`/Groups/${resolvedGroup}`)) {
    return { created: false, gid: readPrimaryGroupId(resolvedGroup) };
  }

  // Otherwise, create a group with the next free GID
  const gid = nextFreeId(listIds('/Groups', 'PrimaryGroupID'), MIN_GID);
  sudoDscl(['-create', `/Groups/${resolvedGroup}`]);
  sudoDscl(['-create', `/Groups/${resolvedGroup}`, 'PrimaryGroupID', String(gid)]);
  return { created: true, gid };
}

/**
 * Remove the sandbox group from Directory Services if it exists. Refuses to
 * delete a group whose GID is below MIN_GID, which suggests it is not a
 * CodeGoat-managed group.
 *
 * @param groupName Group name. Defaults to resolveGroup() (process.env.AGENT_GROUP).
 */
export function removeGroupIfExists(groupName?: string): RemoveGroupResult {
  const resolvedGroup = resolveGroup(groupName);

  if (process.platform !== 'darwin') {
    throw new Error('The Agentrail sandbox group can only be removed on macOS.');
  }
  if (!NAME_PATTERN.test(resolvedGroup)) {
    throw new Error(`Invalid group name: ${resolvedGroup}`);
  }

  // Check if group is already deleted
  const groupPath = `/Groups/${resolvedGroup}`;
  if (!dsclExists(groupPath)) return { groupRemoved: false };

  // Otherwise read the gid and delete the group.
  const gid = readNumericAttr(groupPath, 'PrimaryGroupID');
  if (gid === null) {
    throw new Error(
      `Refusing to delete group '${resolvedGroup}': its PrimaryGroupID could not be read, ` +
        'so it cannot be confirmed as an agentrail-managed group.',
    );
  }
  if (gid < MIN_GID) {
    throw new Error(
      `Refusing to delete group '${resolvedGroup}': GID ${gid} is below ${MIN_GID}, ` +
        'which suggests this is not a Agentrail-managed group.',
    );
  }
  sudoDscl(['-delete', groupPath]);
  return { groupRemoved: true };
}
