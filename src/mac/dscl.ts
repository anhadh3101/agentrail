import { execFileSync } from 'node:child_process';

// Directory Services IDs at or above these thresholds are considered agentrail-managed.
// Deletion refuses to touch records below them.
export const MIN_UID = 601;
export const MIN_GID = 701;

// Valid shape for a user or group name.
export const NAME_PATTERN = /^[a-z_][a-z0-9_-]*$/i;

/**
 * Whether a Directory Services record (e.g. /Users/foo, /Groups/bar) exists.
 * @param recordPath Path to a record in macOS Directory Services (DS), such as `/Users/foo` or `/Groups/bar`.
 * @returns `true` if the record exists, `false` otherwise.
 */
export function dsclExists(recordPath: string): boolean {
  try {
    execFileSync('dscl', ['.', '-read', recordPath], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Collect the numeric values of `attribute` across every record under `basePath`.
 * @param basePath DS base path to list records from, such as `/Users` or `/Groups`.
 * @param attribute DS attribute to read from each record, such as `UniqueID` or `PrimaryGroupID`.
 * @returns A set of all numeric IDs found under `basePath` for the given attribute.
 */
export function listIds(basePath: string, attribute: string): Set<number> {
  // Get the output from the dscl list command
  const out = execFileSync('dscl', ['.', '-list', basePath, attribute], {
    encoding: 'utf8',
  });

  // Iterate over the entries and add them to a ids set
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

/**
 * Lowest id >= min that is not already in `used`.
 * @param used Set of used ids
 * @param min The min id number
 * @returns The next free id number
 */
export function nextFreeId(used: Set<number>, min: number): number {
  let id = min;
  while (used.has(id)) {
    id += 1;
  }
  return id;
}

/**
 * Read a single numeric attribute off a record, or null if absent.
 * @param recordPath Path to a DS record, such as `/Users/foo` or `/Groups/bar`.
 * @param attribute DS attribute to read, such as `UniqueID` or `PrimaryGroupID`.
 * @returns The parsed numeric value, or `null` if the attribute is missing or not numeric.
 */
export function readNumericAttr(
  recordPath: string,
  attribute: string,
): number | null {
  const out = execFileSync('dscl', ['.', '-read', recordPath, attribute], {
    encoding: 'utf8',
  });
  const match = out.match(new RegExp(`${attribute}:\\s*(\\d+)`));
  return match ? Number.parseInt(match[1], 10) : null;
}

/**
 * Run `dscl . <args>` under sudo, passing stdio through for password prompts.
 * @param args Arguments to pass to `dscl` after the `.` node, such as `['-create', '/Users/foo']`.
 */
export function sudoDscl(args: string[]): void {
  execFileSync('sudo', ['dscl', '.', ...args], { stdio: 'inherit' });
}
