import { describe, it, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  dsclExists,
  listIds,
  nextFreeId,
  readNumericAttr,
  MIN_UID,
  MIN_GID,
} from '../../src/mac/dscl';
import { mockExecFileSync } from '../helpers/mockExec';

describe('dscl helpers', () => {
  afterEach(() => mock.restoreAll());

  describe('nextFreeId (pure)', () => {
    it('returns the minimum when nothing is used', () => {
      assert.equal(nextFreeId(new Set(), MIN_UID), 601);
    });

    it('skips a run of consecutive used ids', () => {
      assert.equal(nextFreeId(new Set([601, 602, 603]), MIN_UID), 604);
    });

    it('returns the minimum when the used ids sit above it', () => {
      assert.equal(nextFreeId(new Set([705, 706]), MIN_GID), 701);
    });
  });

  describe('listIds', () => {
    it('parses the trailing integer of each line, ignoring blanks and non-numeric lines', () => {
      const exec = mockExecFileSync(
        () => 'user_a       501\nuser_b       502\n\nnobody_here\nuser_c       502\n',
      );

      const ids = listIds('/Users', 'UniqueID');

      assert.deepEqual([...ids].sort((a, b) => a - b), [501, 502]);
      assert.deepEqual(exec.calls()[0], {
        file: 'dscl',
        args: ['.', '-list', '/Users', 'UniqueID'],
      });
    });
  });

  describe('readNumericAttr', () => {
    it('extracts the numeric value of the attribute', () => {
      mockExecFileSync(() => 'UniqueID: 501\n');
      assert.equal(readNumericAttr('/Users/agentrail', 'UniqueID'), 501);
    });

    it('returns null when the attribute is not present in the output', () => {
      mockExecFileSync(() => 'name: agentrail\n');
      assert.equal(readNumericAttr('/Users/agentrail', 'UniqueID'), null);
    });
  });

  describe('dsclExists', () => {
    it('is true when the dscl read succeeds', () => {
      mockExecFileSync(() => '');
      assert.equal(dsclExists('/Users/agentrail'), true);
    });

    it('is false when the dscl read throws', () => {
      mockExecFileSync(() => {
        throw new Error('<dscl> DS Error: -14136 (eDSRecordNotFound)');
      });
      assert.equal(dsclExists('/Users/nope'), false);
    });
  });
});
