import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import os from 'node:os';
import { resolveUsername, resolveGroup } from '../config';
import { appendGroupMember, createGroupIfNotExists } from './group';
import {
  MIN_UID,
  NAME_PATTERN,
  dsclExists,
  listIds,
  nextFreeId,
  readNumericAttr,
  sudoDscl,
} from './dscl';

export interface CreateUserResult {
  created: boolean;
}

export interface RemoveUserResult {
  userRemoved: boolean;
}

/**
 * The admin account to add to the sandbox group, or null when running as root.
 * @returns The admin username for the user
 */
function resolveAdminUser(): string | null {
  const admin = process.env.SUDO_USER || os.userInfo().username;
  if (!admin || admin === 'root') return null;
  return admin;
}

/**
 * Create a passwordless, login-disabled user record with an empty home dir.
 * @param username The name of the agent user
 * @param uid The unique id for the user
 * @param gid The group id for the user
 */
function createRestrictedUser(username: string, uid: number, gid: number): void {
  const password = crypto.randomBytes(32).toString('base64');
  const userPath = `/Users/${username}`;

  // Create the user with attributes using super user privileges in the DSCL
  sudoDscl(['-create', userPath]);
  sudoDscl(['-create', userPath, 'UserShell', '/usr/bin/false']);
  sudoDscl(['-create', userPath, 'RealName', 'Agent User']);
  sudoDscl(['-create', userPath, 'UniqueID', String(uid)]);
  sudoDscl(['-create', userPath, 'PrimaryGroupID', String(gid)]);
  sudoDscl(['-create', userPath, 'NFSHomeDirectory', '/var/empty']);
  execFileSync('sudo', ['dscl', '.', '-passwd', userPath, password], {
    stdio: 'inherit',
  });
  sudoDscl(['-create', userPath, 'AuthenticationAuthority', ';DisabledUser;']);
}

/**
 * Create the restricted agent user in Directory Services if it does not exist.
 * Ensures the sandbox group exists first (via createGroupIfNotExists) and adds
 * both the new user and the invoking admin to it.
 *
 * @param username Agent user name. Defaults to resolveUsername() (process.env.AGENT_USERNAME).
 */
export function createUserIfNotExists(username?: string): CreateUserResult {
  const resolvedUsername = resolveUsername(username);

  if (process.platform !== 'darwin') {
    throw new Error(`The Agentrail sandbox user can only be created on macOS.`);
  }
  if (!NAME_PATTERN.test(resolvedUsername)) {
    throw new Error(`Invalid username: ${resolvedUsername}`);
  }

  // If the user already exits do nothing
  if (dsclExists(`/Users/${resolvedUsername}`)) {
    return { created: false };
  }

  // Get the group name and id.
  const groupName = resolveGroup();
  const { gid } = createGroupIfNotExists(groupName);
  const uid = nextFreeId(listIds('/Users', 'UniqueID'), MIN_UID);

  // Create a user with restricited access using the generated uid and gid
  // Add the agent user to the group
  createRestrictedUser(resolvedUsername, uid, gid);
  appendGroupMember(groupName, resolvedUsername);

  // Also add the admin user who created the user to the group
  const admin = resolveAdminUser();
  if (admin && admin !== resolvedUsername) {
    appendGroupMember(groupName, admin);
  }

  return { created: true };
}

/**
 * Remove the agent user from Directory Services if it exists. Refuses to delete
 * a user whose UID is below MIN_UID, which suggests it is not a CodeGoat-managed
 * account. Does not touch the sandbox group — see removeGroupIfExists.
 *
 * @param username Agent user name. Defaults to resolveUsername() (process.env.AGENT_USERNAME).
 */
export function removeUserIfExists(username?: string): RemoveUserResult {
  const resolvedUsername = resolveUsername(username);

  if (process.platform !== 'darwin') {
    throw new Error('The Agentrail sandbox user can only be removed on macOS.');
  }
  if (!NAME_PATTERN.test(resolvedUsername)) {
    throw new Error(`Invalid username: ${resolvedUsername}`);
  }

  // Check if user path exists and if not, then the job is done
  const userPath = `/Users/${resolvedUsername}`;
  if (!dsclExists(userPath)) return { userRemoved: false };

  // Find the uid from the user path and only throw an error if it is null or is one of the packaged users.
  const uid = readNumericAttr(userPath, 'UniqueID');
  if (uid === null) {
    throw new Error(
      `Refusing to delete '${resolvedUsername}': its UniqueID could not be read, ` +
        'so it cannot be confirmed as an Agentrail-managed account.',
    );
  }
  if (uid < MIN_UID) {
    throw new Error(
      `Refusing to delete '${resolvedUsername}': UID ${uid} is below ${MIN_UID}, which ` +
        'suggests this is not a Agentrail-managed account.',
    );
  }

  // Run the sudo command to delete the user
  sudoDscl(['-delete', userPath]);
  return { userRemoved: true };
}
