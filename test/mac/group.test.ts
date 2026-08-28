import { describe, it, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGroupIfNotExists,
  getGroupMembers,
  readPrimaryGroupId,
  removeGroupIfExists,
} from '../../src/mac/group';
import { mockExecFileSync } from '../helpers/mockExec';

const GROUP = 'agentrail-group';
const GROUP_PATH = `/Groups/${GROUP}`;

// Route a mocked execFileSync by the dscl sub-command being run.
function router(handlers: {
  exists?: boolean; // whether the `-read <path>` probe (dsclExists) succeeds
  primaryGroupId?: string; // stdout for `-read <path> PrimaryGroupID`
  membership?: string; // stdout for `-read <path> GroupMembership`
  onSudo?: (args: string[]) => void;
}) {
  return (file: string, args: string[]): unknown => {
    const joined = args.join(' ');

    if (file === 'sudo') {
      handlers.onSudo?.(args);
      return '';
    }
    if (file === 'dscl' && joined.includes('-read') && joined.includes('PrimaryGroupID')) {
      return handlers.primaryGroupId ?? 'PrimaryGroupID: 800\n';
    }
    if (file === 'dscl' && joined.includes('-read') && joined.includes('GroupMembership')) {
      return handlers.membership ?? '';
    }
    if (file === 'dscl' && joined.includes('-read')) {
      // dsclExists probe
      if (handlers.exists) return '';
      throw new Error('eDSRecordNotFound');
    }
    if (file === 'dscl' && joined.includes('-list')) {
      return 'existing 777\n';
    }
    throw new Error(`unexpected exec: ${file} ${joined}`);
  };
}

describe('group management', () => {
  afterEach(() => mock.restoreAll());

  describe('getGroupMembers', () => {
    it('parses a space-separated GroupMembership line into a set', () => {
      mockExecFileSync(() => 'GroupMembership: alice bob carol\n');
      assert.deepEqual(getGroupMembers(GROUP), new Set(['alice', 'bob', 'carol']));
    });

    it('returns an empty set when the group record cannot be read', () => {
      mockExecFileSync(() => {
        throw new Error('eDSRecordNotFound');
      });
      assert.deepEqual(getGroupMembers(GROUP), new Set());
    });
  });

  describe('readPrimaryGroupId', () => {
    it('throws when the output has no PrimaryGroupID', () => {
      mockExecFileSync(() => 'RecordName: agentrail-group\n');
      assert.throws(() => readPrimaryGroupId(GROUP), /Could not read PrimaryGroupID/);
    });
  });

  describe('removeGroupIfExists', () => {
    it('refuses to delete a group whose GID is below the managed floor', () => {
      const exec = mockExecFileSync(
        router({ exists: true, primaryGroupId: 'PrimaryGroupID: 500\n' }),
      );

      assert.throws(
        () => removeGroupIfExists(GROUP),
        /Refusing to delete group '.*': GID 500 is below 701/,
      );
      assert.equal(exec.callsWith('-delete').length, 0, 'must not issue a delete');
    });

    it('is a no-op when the group record does not exist', () => {
      const exec = mockExecFileSync(router({ exists: false }));

      assert.deepEqual(removeGroupIfExists(GROUP), { groupRemoved: false });
      assert.equal(exec.calls().filter((c) => c.file === 'sudo').length, 0);
    });

    it('deletes a managed group and reports it removed', () => {
      const exec = mockExecFileSync(
        router({ exists: true, primaryGroupId: 'PrimaryGroupID: 801\n' }),
      );

      assert.deepEqual(removeGroupIfExists(GROUP), { groupRemoved: true });
      assert.deepEqual(exec.callsWith('-delete')[0], {
        file: 'sudo',
        args: ['dscl', '.', '-delete', GROUP_PATH],
      });
    });
  });

  describe('createGroupIfNotExists', () => {
    it('rejects a syntactically invalid group name', () => {
      mockExecFileSync(() => '');
      assert.throws(() => createGroupIfNotExists('Bad Name'), /Invalid group name/);
    });

    it('short-circuits when the group already exists, returning its gid', () => {
      const exec = mockExecFileSync(
        router({ exists: true, primaryGroupId: 'PrimaryGroupID: 742\n' }),
      );

      assert.deepEqual(createGroupIfNotExists(GROUP), { created: false, gid: 742 });
      assert.equal(exec.callsWith('-create').length, 0);
    });

    it('creates the group with the next free gid when it is absent', () => {
      const exec = mockExecFileSync(router({ exists: false }));

      // listIds -> {777}, so nextFreeId(_, 701) -> 701
      assert.deepEqual(createGroupIfNotExists(GROUP), { created: true, gid: 701 });
      assert.deepEqual(exec.callsWith('PrimaryGroupID').at(-1), {
        file: 'sudo',
        args: ['dscl', '.', '-create', GROUP_PATH, 'PrimaryGroupID', '701'],
      });
    });
  });
});
