import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveGroup, resolveAppName } from '../config';

// State file: tracks which dirs got an ACE granted (split by kind — ancestor
// traverse-only vs. recursive full-access target dir), so revokeTraverseGrants() can find
// them even from a separate CLI invocation (e.g. `codegoat reset user`). See SYSTEM_SETUP.md.
const GRANT_STATE_DIR = path.join(os.homedir(), `.${resolveAppName()}`);
const GRANT_STATE_FILE = path.join(GRANT_STATE_DIR, 'granted-dirs.json');

// Full permission set granted (via -R) on the sandboxed target directory itself.
const TARGET_ACE_PERMS =
  'list,add_file,search,delete,add_subdirectory,delete_child,read,write,execute,' +
  'readattr,writeattr,readextattr,writeextattr,file_inherit,directory_inherit';

interface GrantState {
  traverseDirs: string[];
  targetDirs: string[];
}

const EMPTY_STATE: GrantState = { traverseDirs: [], targetDirs: [] };

/**
 * Read the persisted grant state. Empty lists if file missing/invalid.
 */
function readGrantState(): GrantState {
  try {
    const parsed = JSON.parse(fs.readFileSync(GRANT_STATE_FILE, 'utf8'));
    return {
      traverseDirs: Array.isArray(parsed.traverseDirs) ? parsed.traverseDirs : [],
      targetDirs: Array.isArray(parsed.targetDirs) ? parsed.targetDirs : [],
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

/**
 * Overwrite the persisted grant state on disk (creates state dir if needed).
 */
function writeGrantState(state: GrantState): void {
  fs.mkdirSync(GRANT_STATE_DIR, { recursive: true });
  fs.writeFileSync(GRANT_STATE_FILE, JSON.stringify(state, null, 2));
}

// Add dir to the persisted traverseDirs list, skipping duplicates.
function appendTraverseDir(dir: string): void {
  const state = readGrantState();
  if (!state.traverseDirs.includes(dir)) {
    state.traverseDirs.push(dir);
    writeGrantState(state);
  }
}

// Add dir to the persisted targetDirs list, skipping duplicates.
function appendTargetDir(dir: string): void {
  const state = readGrantState();
  if (!state.targetDirs.includes(dir)) {
    state.targetDirs.push(dir);
    writeGrantState(state);
  }
}

// Check whether dir already has a "group:<group> allow search" ACE via `ls -lde`.
function hasSearchAce(dir: string, group: string): boolean {
  const out = execFileSync('ls', ['-lde', dir], { encoding: 'utf8' });
  return new RegExp(`group:${group} allow.*search`).test(out);
}

// Check whether dir already has the full target ACE (all TARGET_ACE_PERMS) for group.
function hasTargetAce(dir: string, group: string): boolean {
  const out = execFileSync('ls', ['-lde', dir], { encoding: 'utf8' });
  const escaped = TARGET_ACE_PERMS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`group:${group} allow ${escaped}`).test(out);
}

// Check whether dir already has the world-execute (traverse) bit set.
function isWorldTraversable(dir: string): boolean {
  const mode = fs.statSync(dir).mode;
  return (mode & 0o001) !== 0;
}

// Grant group a traverse-only (search) ACE on dir, record it for later revocation.
function grantTraverse(dir: string, group: string): void {
  // Check if the directory has world-execute/traverse bit set
  if (hasSearchAce(dir, group)) return;

  // Grant traverse permission to the user group and append the dir name to the JSON list
  execFileSync('chmod', ['+a', `group:${group} allow search`, dir]);
  appendTraverseDir(dir);
}

// Grant group full read/write/execute access on targetDir via ACL (recursive), with
// inherit flags so files/subdirs created later under targetDir pick it up too. Records
// targetDir for later recursive revocation.
function scopeTargetDirectory(targetDir: string, group: string): void {
  // Skip if targetDir itself already carries the ACE — avoids stacking duplicates on repeat runs.
  // (Does not check descendants; -R re-applies to them regardless, which is idempotent.)
  if (hasTargetAce(targetDir, group)) return;

  // Give user complete access to the target directory
  execFileSync('chmod', ['-R', '+a', `group:${group} allow ${TARGET_ACE_PERMS}`, targetDir]);
  // Save the ACE in the JSON file.
  appendTargetDir(targetDir);
}

// Walk up from targetDir's parent all the way to root, granting a traverse ACE on each
// ancestor that needs one. A directory being already traversable (or already having the
// ACE) only means *that* directory can be skipped — it says nothing about its parents, so
// the walk must not stop early on it.
function grantTraverseOnAncestors(targetDir: string, group: string): void {
  let dir = path.dirname(targetDir);

  while (dir !== '/' && dir !== path.dirname(dir)) {
    if (!isWorldTraversable(dir) && !hasSearchAce(dir, group)) {
      grantTraverse(dir, group);
    }
    dir = path.dirname(dir);
  }
}

// Public entry: scope targetDir to sandbox group and grant ancestor-chain traverse access.
export function scopeAccess(targetDir: string, groupName?: string): void {
  const group = resolveGroup(groupName);
  const resolved = path.resolve(targetDir);
  scopeTargetDirectory(resolved, group);
  grantTraverseOnAncestors(resolved, group);
}

// Public entry: strip every ACE previously granted (persisted state), best-effort, then
// clear the persisted state. Target dirs are stripped recursively (-R), matching how they
// were granted; ancestor traverse dirs are stripped individually. Must run before the
// sandbox group's dscl record is deleted.
export function revokeTraverseGrants(groupName?: string): void {
  const state = readGrantState();
  if (state.traverseDirs.length === 0 && state.targetDirs.length === 0) return;

  const group = resolveGroup(groupName);
  const traverseAce = `group:${group} allow search`;
  const targetAce = `group:${group} allow ${TARGET_ACE_PERMS}`;

  // Best-effort: a chmod failure does not stop the sweep, but the dir stays in
  // state so a later revokeTraverseGrants() can retry the removal.
  const failedTargets: string[] = [];
  for (const dir of [...state.targetDirs].reverse()) {
    try {
      execFileSync('chmod', ['-R', '-a', targetAce, dir]);
    } catch {
      failedTargets.push(dir);
    }
  }

  const failedTraverse: string[] = [];
  for (const dir of [...state.traverseDirs].reverse()) {
    try {
      execFileSync('chmod', ['-a', traverseAce, dir]);
    } catch {
      failedTraverse.push(dir);
    }
  }

  writeGrantState({
    traverseDirs: failedTraverse.reverse(),
    targetDirs: failedTargets.reverse(),
  });
}
