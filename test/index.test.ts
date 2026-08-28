import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Public-API contract for the published entry point (src/index.ts). Downstream
// consumers import from here, so both the export surface and the "loads without
// any env configured" guarantee are pinned.

const EXPECTED_EXPORTS = [
  'resolveUsername',
  'resolveGroup',
  'resolveAppName',
  'createUserIfNotExists',
  'removeUserIfExists',
  'createGroupIfNotExists',
  'removeGroupIfExists',
  'scopeAccess',
  'revokeTraverseGrants',
] as const;

describe('public API contract', () => {
  it('entry point imports with a completely clean environment', async () => {
    delete process.env.AGENT_USERNAME;
    delete process.env.AGENT_GROUP;
    delete process.env.APP_NAME;

    await assert.doesNotReject(() => import('../src/index'));
  });

  it('exposes every expected named export as a function', async () => {
    const mod: Record<string, unknown> = await import('../src/index');

    for (const name of EXPECTED_EXPORTS) {
      assert.equal(typeof mod[name], 'function', `missing or non-function export: ${name}`);
    }
  });

  it('exposes no unexpected runtime exports', async () => {
    const mod: Record<string, unknown> = await import('../src/index');

    assert.deepEqual(Object.keys(mod).sort(), [...EXPECTED_EXPORTS].sort());
  });
});
