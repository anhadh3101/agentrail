import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import os from 'node:os';
import { resolveUsername, resolveGroup } from '../username';

const MIN_UID = 601;
const MIN_GID = 701;
const USERNAME_PATTERN = /^[a-z_][a-z0-9_-]*$/i;

export interface CreateUserResult {
  created: boolean;
}

function dsclExists(recordPath: string): boolean {
  try {
    execFileSync('dscl', ['.', '-read', recordPath], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function listIds(basePath: string, attribute: string): Set<number> {
  const out = execFileSync('dscl', ['.', '-list', basePath, attribute], {
    encoding: 'utf8',
  });
  const ids = new Set<number>();

  for (const line of out.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(/\s+/);
    const id = Number.parseInt(parts[parts.length - 1] ?? '', 10);
    if (!Number.isNaN(id)) {
      ids.add(id);
    }
  }

  return ids;
}

function nextFreeId(used: Set<number>, min: number): number {
  let id = min;
  while (used.has(id)) {
    id += 1;
  }
  return id;
}

function readPrimaryGroupId(groupName: string): number {
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

function sudoDscl(args: string[]): void {
  execFileSync('sudo', ['dscl', '.', ...args], { stdio: 'inherit' });
}

function getGroupMembers(groupName: string): Set<string> {
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

function appendGroupMember(groupName: string, member: string): void {
  if (getGroupMembers(groupName).has(member)) return;
  sudoDscl(['-append', `/Groups/${groupName}`, 'GroupMembership', member]);
}

function resolveAdminUser(): string | null {
  const admin = process.env.SUDO_USER || os.userInfo().username;
  if (!admin || admin === 'root') return null;
  return admin;
}

function ensureGroup(groupName: string): number {
  if (dsclExists(`/Groups/${groupName}`)) {
    return readPrimaryGroupId(groupName);
  }

  const gid = nextFreeId(listIds('/Groups', 'PrimaryGroupID'), MIN_GID);
  sudoDscl(['-create', `/Groups/${groupName}`]);
  sudoDscl(['-create', `/Groups/${groupName}`, 'PrimaryGroupID', String(gid)]);
  return gid;
}

function createRestrictedUser(username: string, uid: number, gid: number): void {
  const password = crypto.randomBytes(32).toString('base64');
  const userPath = `/Users/${username}`;

  sudoDscl(['-create', userPath]);
  sudoDscl(['-create', userPath, 'UserShell', '/usr/bin/false']);
  sudoDscl(['-create', userPath, 'RealName', 'Codegoat Agent User']);
  sudoDscl(['-create', userPath, 'UniqueID', String(uid)]);
  sudoDscl(['-create', userPath, 'PrimaryGroupID', String(gid)]);
  sudoDscl(['-create', userPath, 'NFSHomeDirectory', '/var/empty']);
  execFileSync('sudo', ['dscl', '.', '-passwd', userPath, password], {
    stdio: 'inherit',
  });
  sudoDscl(['-create', userPath, 'AuthenticationAuthority', ';DisabledUser;']);
}

/**
 * Create a user in the Directory Service of the mac device, if it doesn't exist
 *
 * @param username The name of the user (in this case, name of the agent user).
 * Defaults to resolveUsername() (process.env.AGENT_USERNAME) when omitted.
 * @returns An object that contains a boolen value
 */
export function createUserIfNotExists(username?: string): CreateUserResult {
  const resolvedUsername = resolveUsername(username);

  // Check if the platform is macbook
  if (process.platform !== 'darwin') {
    throw new Error('The CodeGoat sandbox user can only be created on macOS.');
  }

  // Validates the username
  if (!USERNAME_PATTERN.test(resolvedUsername)) {
    throw new Error(`Invalid username: ${resolvedUsername}`);
  }

  // Checks if a user already exists.
  if (dsclExists(`/Users/${resolvedUsername}`)) {
    return { created: false };
  }


  const groupName = resolveGroup();
  const gid = ensureGroup(groupName);
  const uid = nextFreeId(listIds('/Users', 'UniqueID'), MIN_UID);

  createRestrictedUser(resolvedUsername, uid, gid);
  appendGroupMember(groupName, resolvedUsername);

  const admin = resolveAdminUser();
  if (admin && admin !== resolvedUsername) {
    appendGroupMember(groupName, admin);
  }

  return { created: true };
}
