import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createUserIfNotExists, removeUserIfExists } from '../../src/mac/user';
import { createGroupIfNotExists, removeGroupIfExists } from '../../src/mac/group';
import { mockExecFileSync } from '../helpers/mockExec';

// Integration: create a user through the module, then delete it through the
// module, with a single in-memory Directory Services fake shared across both
// calls. createUserIfNotExists writes records (user + its group); the later
// reads in removeUserIfExists / removeGroupIfExists see exactly what was written.

const USER = 'agentrail';
const GROUP = 'agentrail-group';
const USER_PATH = `/Users/${USER}`;
const GROUP_PATH = `/Groups/${GROUP}`;

/**
 * Minimal stand-in for `dscl`. Plain `dscl` invocations are reads; `sudo dscl`
 * invocations are mutations — matching how the source splits them.
 */
function createDsclFake() {
  // record path -> (attribute -> value)
  const records = new Map<string, Map<string, string>>();

  function read(path: string, attr?: string): string {
    const rec = records.get(path);
    if (!rec) throw new Error(`<dscl> DS Error: -14136 (eDSRecordNotFound): ${path}`);
    if (!attr) return ''; // existence probe
    if (!rec.has(attr)) return '';
    return `${attr}: ${rec.get(attr)}\n`;
  }

  function list(base: string, attr: string): string {
    const prefix = base.endsWith('/') ? base : `${base}/`;
    const lines: string[] = [];
    for (const [path, rec] of records) {
      if (path.startsWith(prefix) && rec.has(attr)) {
        lines.push(`${path.slice(prefix.length)}\t${rec.get(attr)}`);
      }
    }
    return lines.join('\n') + (lines.length ? '\n' : '');
  }

  function ensure(path: string): Map<string, string> {
    let rec = records.get(path);
    if (!rec) {
      rec = new Map();
      records.set(path, rec);
    }
    return rec;
  }

  function mutate(args: string[]): string {
    // args === ['dscl', '.', <op>, <path>, ...rest]
    const [, , op, path, ...rest] = args;

    if (op === '-create') {
      const rec = ensure(path);
      if (rest.length >= 2) rec.set(rest[0], rest[1]);
      return '';
    }
    if (op === '-append') {
      const rec = ensure(path);
      const [attr, value] = rest;
      const current = rec.get(attr);
      rec.set(attr, current ? `${current} ${value}` : value);
      return '';
    }
    if (op === '-delete') {
      if (rest.length === 0) records.delete(path);
      else records.get(path)?.delete(rest[0]);
      return '';
    }
    if (op === '-passwd') return '';
    throw new Error(`dscl fake: unhandled sudo op ${op}`);
  }

  const impl = (file: string, args: string[]): string => {
    if (file === 'sudo') {
      if (args[0] !== 'dscl') throw new Error(`dscl fake: unexpected sudo ${args[0]}`);
      return mutate(args);
    }
    if (file === 'dscl') {
      const [, op, ...rest] = args;
      if (op === '-read') return read(rest[0], rest[1]);
      if (op === '-list') return list(rest[0], rest[1]);
      throw new Error(`dscl fake: unhandled read op ${op}`);
    }
    throw new Error(`dscl fake: unexpected exec ${file}`);
  };

  return { impl, records };
}

describe('user + group create/delete lifecycle', () => {
  const savedEnv = { AGENT_GROUP: process.env.AGENT_GROUP, SUDO_USER: process.env.SUDO_USER };
  const realPlatform = process.platform;

  beforeEach(() => {
    process.env.AGENT_GROUP = GROUP;
    process.env.SUDO_USER = 'operator'; // deterministic resolveAdminUser()
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  });

  afterEach(() => {
    mock.restoreAll();
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('creates a user via the module, then deletes it via the module', () => {
    const dscl = createDsclFake();
    const exec = mockExecFileSync(dscl.impl);

    // --- create ---
    assert.deepEqual(createUserIfNotExists(USER), { created: true });

    // the group was auto-created with the first free gid (empty -> 701)
    assert.equal(dscl.records.get(GROUP_PATH)?.get('PrimaryGroupID'), '701');
    // the user record exists with the first free uid (empty -> 601) and is login-disabled
    assert.equal(dscl.records.get(USER_PATH)?.get('UniqueID'), '601');
    assert.equal(dscl.records.get(USER_PATH)?.get('PrimaryGroupID'), '701');
    assert.equal(dscl.records.get(USER_PATH)?.get('UserShell'), '/usr/bin/false');
    // both the new user and the invoking admin joined the group
    assert.deepEqual(
      new Set(dscl.records.get(GROUP_PATH)?.get('GroupMembership')?.split(' ')),
      new Set([USER, 'operator']),
    );
    // password was set through a dedicated sudo dscl -passwd call
    assert.ok(exec.calls().some((c) => c.file === 'sudo' && c.args.includes('-passwd')));

    // calling create again is now a no-op (record is visible to the existence probe)
    assert.deepEqual(createUserIfNotExists(USER), { created: false });

    // --- delete ---
    assert.deepEqual(removeUserIfExists(USER), { userRemoved: true });
    assert.deepEqual(exec.callsWith('-delete').at(-1), {
      file: 'sudo',
      args: ['dscl', '.', '-delete', USER_PATH],
    });
    // the record is actually gone from the shared state
    assert.equal(dscl.records.has(USER_PATH), false);
    // idempotent: a second delete sees nothing to remove
    assert.deepEqual(removeUserIfExists(USER), { userRemoved: false });

    // --- group teardown (consumer runs this right after the user delete) ---
    assert.deepEqual(removeGroupIfExists(GROUP), { groupRemoved: true });
    assert.equal(dscl.records.has(GROUP_PATH), false);
    assert.deepEqual(removeGroupIfExists(GROUP), { groupRemoved: false });
  });

  it('round-trips the group on its own: createGroupIfNotExists then removeGroupIfExists', () => {
    const dscl = createDsclFake();
    mockExecFileSync(dscl.impl);

    const created = createGroupIfNotExists(GROUP);
    assert.equal(created.created, true);
    assert.equal(created.gid, 701);

    // second create is a no-op that reports the existing gid
    assert.deepEqual(createGroupIfNotExists(GROUP), { created: false, gid: 701 });

    assert.deepEqual(removeGroupIfExists(GROUP), { groupRemoved: true });
    assert.equal(dscl.records.has(GROUP_PATH), false);
  });
});
