import { mock } from 'node:test';
import { createRequire } from 'node:module';

// Grab the *CommonJS* child_process exports object. tsx compiles both this file
// and the source under test to CJS, so both resolve `node:child_process` to this
// exact cached object and its `execFileSync` own-property — which is what
// `mock.method` needs (a namespace import exposes it as a non-configurable getter
// instead, which `mock.method` rejects).
const childProcess = createRequire(__filename)(
  'node:child_process',
) as typeof import('node:child_process');

export interface ExecCall {
  file: string;
  args: string[];
}

/**
 * Replace `child_process.execFileSync` with a fake for the duration of a test.
 *
 * agentrail's modules do `import { execFileSync } from 'node:child_process'`.
 * tsx transpiles the source to CommonJS, so that import compiles to a property
 * access on the shared `require('node:child_process')` object — the very object
 * this helper also imports. Swapping the method on it therefore intercepts every
 * call the code under test makes. Pair with `mock.restoreAll()` in `afterEach`.
 *
 * @param impl Called with (file, args) for each invocation. Return a string to
 *   stand in for stdout; throw to simulate a non-zero exit (e.g. "record not found").
 */
export function mockExecFileSync(
  impl: (file: string, args: string[]) => unknown = () => '',
) {
  const m = mock.method(
    childProcess,
    'execFileSync',
    ((file: string, args: string[]) => impl(file, args)) as typeof childProcess.execFileSync,
  );

  return {
    /** Raw node:test mock, for `.mock.callCount()` etc. */
    raw: m,
    /** Every (file, args) pair passed to execFileSync, in call order. */
    calls(): ExecCall[] {
      return m.mock.calls.map((c) => ({
        file: c.arguments[0] as string,
        args: (c.arguments[1] ?? []) as string[],
      }));
    },
    /** Calls whose args array contains the given dscl/chmod verb (e.g. '-delete'). */
    callsWith(verb: string): ExecCall[] {
      return this.calls().filter((c) => c.args.includes(verb));
    },
  };
}
