import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createUserIfNotExists, removeUserIfExists } from '../../src/mac/user';
import { mockExecFileSync } from '../helpers/mockExec';

const USER = 'agentrail';
const USER_PATH = `/Users/${USER}`;
const GROUP = 'agentrail-group';

describe('user management', () => {
  const realPlatform = process.platform;
  const savedEnv = {
    AGENT_GROUP: process.env.AGENT_GROUP,
    SUDO_USER: process.env.SUDO_USER,
  };

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    process.env.AGENT_GROUP = GROUP;
    process.env.SUDO_USER = 'operator'; // make resolveAdminUser() deterministic
  });

  afterEach(() => {
    mock.restoreAll();
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  describe('removeUserIfExists', () => {
    it('refuses to delete a user whose UID is below the managed floor', () => {
      const exec = mockExecFileSync((file, args) => {
        const joined = args.join(' ');
        if (file === 'dscl' && joined.includes('-read') && joined.includes('UniqueID')) {
          return 'UniqueID: 501\n';
        }
        if (file === 'dscl' && joined.includes('-read')) return ''; // dsclExists probe
        throw new Error(`unexpected exec: ${file} ${joined}`);
      });

      assert.throws(
        () => removeUserIfExists(USER),
        /Refusing to delete '.*': UID 501 is below 601/,
      );
      assert.equal(exec.callsWith('-delete').length, 0);
    });

    it('is a no-op when the user record does not exist', () => {
      const exec = mockExecFileSync(() => {
        throw new Error('eDSRecordNotFound');
      });

      assert.deepEqual(removeUserIfExists(USER), { userRemoved: false });
      assert.equal(exec.calls().filter((c) => c.file === 'sudo').length, 0);
    });

    it('deletes a managed user and reports it removed', () => {
      const exec = mockExecFileSync((file, args) => {
        const joined = args.join(' ');
        if (file === 'dscl' && joined.includes('-read') && joined.includes('UniqueID')) {
          return 'UniqueID: 750\n';
        }
        if (file === 'dscl' && joined.includes('-read')) return '';
        if (file === 'sudo') return '';
        throw new Error(`unexpected exec: ${file} ${joined}`);
      });

      assert.deepEqual(removeUserIfExists(USER), { userRemoved: true });
      assert.deepEqual(exec.callsWith('-delete')[0], {
        file: 'sudo',
        args: ['dscl', '.', '-delete', USER_PATH],
      });
    });
  });

  describe('createUserIfNotExists', () => {
    it('rejects a syntactically invalid username', () => {
      mockExecFileSync(() => '');
      assert.throws(() => createUserIfNotExists('Bad Name'), /Invalid username/);
    });

    it('short-circuits with no privileged calls when the user already exists', () => {
      const exec = mockExecFileSync((file, args) => {
        const joined = args.join(' ');
        if (file === 'dscl' && joined === `. -read ${USER_PATH}`) return ''; // exists
        throw new Error(`unexpected exec: ${file} ${joined}`);
      });

      assert.deepEqual(createUserIfNotExists(USER), { created: false });
      assert.equal(exec.calls().filter((c) => c.file === 'sudo').length, 0);
    });

    // Integration: user absent + group absent -> full provisioning path across
    // config, dscl, group and user modules.
    it('provisions a fresh user: creates the group, allocates ids, adds memberships', () => {
      const exec = mockExecFileSync((file, args) => {
        const joined = args.join(' ');

        // dsclExists(/Users/agentrail) -> absent
        if (file === 'dscl' && joined === `. -read ${USER_PATH}`) {
          throw new Error('eDSRecordNotFound');
        }
        // createGroupIfNotExists -> dsclExists(/Groups/...) -> absent
        if (file === 'dscl' && joined === `. -read /Groups/${GROUP}`) {
          throw new Error('eDSRecordNotFound');
        }
        // listIds(/Groups, PrimaryGroupID) and listIds(/Users, UniqueID)
        if (file === 'dscl' && joined === '. -list /Groups PrimaryGroupID') return 'g 701\n';
        if (file === 'dscl' && joined === '. -list /Users UniqueID') return 'u 601\n';
        // getGroupMembers(...) during appendGroupMember -> empty membership
        if (file === 'dscl' && joined.includes('GroupMembership')) return '';
        // every privileged mutation succeeds
        if (file === 'sudo') return '';
        throw new Error(`unexpected exec: ${file} ${joined}`);
      });

      const result = createUserIfNotExists(USER);
      assert.deepEqual(result, { created: true });

      const sudo = exec.calls().filter((c) => c.file === 'sudo').map((c) => c.args.join(' '));

      // group created with the next free gid (listIds -> {701} => 702)
      assert.ok(sudo.includes(`dscl . -create /Groups/${GROUP} PrimaryGroupID 702`));
      // restricted user record created with the next free uid ({601} => 602)
      assert.ok(sudo.includes(`dscl . -create ${USER_PATH}`));
      assert.ok(sudo.includes(`dscl . -create ${USER_PATH} UniqueID 602`));
      assert.ok(sudo.includes(`dscl . -create ${USER_PATH} UserShell /usr/bin/false`));
      // both the new user and the invoking admin joined the group
      assert.ok(
        sudo.includes(`dscl . -append /Groups/${GROUP} GroupMembership ${USER}`),
      );
      assert.ok(
        sudo.includes(`dscl . -append /Groups/${GROUP} GroupMembership operator`),
      );
      // password is set via a dedicated sudo dscl -passwd invocation
      assert.ok(
        exec.calls().some((c) => c.file === 'sudo' && c.args.includes('-passwd')),
      );
    });
  });
});
