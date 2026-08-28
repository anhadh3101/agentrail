import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveUsername, resolveGroup, resolveAppName } from '../src/config';

// Unit tests for the env-driven config resolvers. Pure functions, no mocks —
// just save and restore the three env vars they read.

const ENV_KEYS = ['AGENT_USERNAME', 'AGENT_GROUP', 'APP_NAME'] as const;

describe('config resolvers', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  describe('resolveUsername', () => {
    it('returns the explicit argument even when the env var is set', () => {
      process.env.AGENT_USERNAME = 'from-env';
      assert.equal(resolveUsername('explicit'), 'explicit');
    });

    it('falls back to AGENT_USERNAME when no argument is given', () => {
      process.env.AGENT_USERNAME = 'env-user';
      assert.equal(resolveUsername(), 'env-user');
    });

    it('defaults to "agentrail" when neither argument nor env var is present', () => {
      assert.equal(resolveUsername(), 'agentrail');
    });
  });

  describe('resolveGroup', () => {
    it('falls back to AGENT_GROUP, then to the "agentrail-group" default', () => {
      process.env.AGENT_GROUP = 'env-group';
      assert.equal(resolveGroup(), 'env-group');

      delete process.env.AGENT_GROUP;
      assert.equal(resolveGroup(), 'agentrail-group');
      assert.equal(resolveGroup('explicit-group'), 'explicit-group');
    });
  });

  describe('resolveAppName', () => {
    it('falls back to APP_NAME, then to the "agentrail" default', () => {
      process.env.APP_NAME = 'env-app';
      assert.equal(resolveAppName(), 'env-app');

      delete process.env.APP_NAME;
      assert.equal(resolveAppName(), 'agentrail');
      assert.equal(resolveAppName('explicit-app'), 'explicit-app');
    });
  });
});
