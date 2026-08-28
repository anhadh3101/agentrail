import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mockExecFileSync } from '../helpers/mockExec';

// scopeAccess.ts computes its grant-state path from os.homedir() + resolveAppName()
// at module load. Point both at a throwaway dir BEFORE importing the module (the
// import is deferred to a `before` hook so these assignments win). node --test runs
// each test file in its own process, so this does not leak into other suites.
const APP = 'agentrail-scopetest';
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agentrail-home-'));
process.env.HOME = tmpHome;
process.env.APP_NAME = APP;

const stateDir = path.join(tmpHome, `.${APP}`);
const stateFile = path.join(stateDir, 'granted-dirs.json');

const PERMS_RE = /^group:mygroup allow list,add_file,.*directory_inherit$/;

type ScopeModule = typeof import('../../src/mac/scopeAccess');

describe('scopeAccess grant lifecycle', () => {
  let mod: ScopeModule;

  before(async () => {
    mod = await import('../../src/mac/scopeAccess');
  });

  beforeEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  afterEach(() => mock.restoreAll());

  describe('revokeTraverseGrants', () => {
    it('does nothing when no grant-state file exists', () => {
      const exec = mockExecFileSync(() => '');

      mod.revokeTraverseGrants('mygroup');

      assert.equal(exec.calls().length, 0);
      assert.equal(fs.existsSync(stateFile), false);
    });

    it('treats a corrupt grant-state file as empty and issues no chmod', () => {
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(stateFile, '{ not valid json');
      const exec = mockExecFileSync(() => '');

      mod.revokeTraverseGrants('mygroup');

      assert.equal(exec.calls().length, 0);
    });

    it('strips target ACEs recursively, then ancestor ACEs, each in reverse order, then clears state', () => {
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(
        stateFile,
        JSON.stringify({
          traverseDirs: ['/Users', '/Users/me/projects'],
          targetDirs: ['/Users/me/projects/one', '/Users/me/projects/two'],
        }),
      );
      const exec = mockExecFileSync(() => '');

      mod.revokeTraverseGrants('mygroup');

      const calls = exec.calls();
      assert.equal(calls.length, 4);
      assert.ok(calls.every((c) => c.file === 'chmod'));

      // targetDirs first — recursive (`-R -a`), reversed
      assert.deepEqual(calls[0].args.slice(0, 2), ['-R', '-a']);
      assert.match(calls[0].args[2], PERMS_RE);
      assert.equal(calls[0].args.at(-1), '/Users/me/projects/two');
      assert.equal(calls[1].args.at(-1), '/Users/me/projects/one');

      // then traverseDirs — non-recursive, reversed
      assert.deepEqual(calls[2].args, ['-a', 'group:mygroup allow search', '/Users/me/projects']);
      assert.deepEqual(calls[3].args, ['-a', 'group:mygroup allow search', '/Users']);

      assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, 'utf8')), {
        traverseDirs: [],
        targetDirs: [],
      });
    });

    it('keeps going after a chmod failure but retains the failed dir for retry', () => {
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(
        stateFile,
        JSON.stringify({
          traverseDirs: ['/Users'],
          targetDirs: ['/Users/me/projects/one', '/Users/me/projects/two'],
        }),
      );
      const exec = mockExecFileSync((_file, args) => {
        if (args.at(-1) === '/Users/me/projects/two') {
          throw new Error('chmod: /Users/me/projects/two: No such file or directory');
        }
        return '';
      });

      assert.doesNotThrow(() => mod.revokeTraverseGrants('mygroup'));

      assert.equal(exec.calls().length, 3); // 2 targets attempted + 1 traverse
      assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, 'utf8')), {
        traverseDirs: [],
        targetDirs: ['/Users/me/projects/two'],
      });
    });
  });

  describe('scopeAccess', () => {
    // Integration: exercises config -> scopeAccess -> grant-state persistence.
    it('grants a recursive ACE on the resolved target dir and records it in state', () => {
      const target = path.join(tmpHome, 'workspace');
      fs.mkdirSync(target, { recursive: true });
      // `ls -lde` -> "" (no existing ACE), every chmod -> ok
      const exec = mockExecFileSync(() => '');

      mod.scopeAccess(target, 'mygroup');

      const grant = exec
        .calls()
        .find(
          (c) =>
            c.file === 'chmod' &&
            c.args[0] === '-R' &&
            c.args[1] === '+a' &&
            c.args.at(-1) === target,
        );
      assert.ok(grant, 'expected a recursive `+a` chmod on the target directory');
      assert.match(grant!.args[2], PERMS_RE);

      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      assert.ok(state.targetDirs.includes(target));
    });
  });
});
