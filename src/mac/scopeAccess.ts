import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveGroup } from '../username';

// Dev-mode state file: tracks which ancestor directories had a traverse ACE
// granted, so revokeTraverseGrants() can find them even from a separate CLI
// invocation (e.g. `codegoat reset user`). See SYSTEM_SETUP.md.
const GRANT_STATE_DIR = path.join(os.homedir(), '.codegoat-dev');
const GRANT_STATE_FILE = path.join(GRANT_STATE_DIR, 'granted-dirs.json');

function readGrantedDirs(): string[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(GRANT_STATE_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeGrantedDirs(dirs: string[]): void {
  fs.mkdirSync(GRANT_STATE_DIR, { recursive: true });
  fs.writeFileSync(GRANT_STATE_FILE, JSON.stringify(dirs, null, 2));
}

function appendGrantedDir(dir: string): void {
  const dirs = readGrantedDirs();
  if (!dirs.includes(dir)) {
    dirs.push(dir);
    writeGrantedDirs(dirs);
  }
}

function hasSearchAce(dir: string, group: string): boolean {
  const out = execFileSync('ls', ['-lde', dir], { encoding: 'utf8' });
  return new RegExp(`group:${group} allow.*search`).test(out);
}

function isWorldTraversable(dir: string): boolean {
  const mode = fs.statSync(dir).mode;
  return (mode & 0o001) !== 0;
}

function grantTraverse(dir: string, group: string): void {
  if (hasSearchAce(dir, group)) return;
  execFileSync('chmod', ['+a', `group:${group} allow search`, dir]);
  appendGrantedDir(dir);
}

function scopeTargetDirectory(targetDir: string, group: string): void {
  execFileSync('chgrp', ['-R', group, targetDir]);
  execFileSync('chmod', ['-R', 'u+rwX,g+rwX,o-rwx', targetDir]);
  execFileSync('chmod', ['g+s', targetDir]);
  execFileSync('chmod', ['+t', targetDir]);
}

function grantTraverseOnAncestors(targetDir: string, group: string): void {
  let dir = path.dirname(targetDir);

  while (dir !== '/' && dir !== path.dirname(dir)) {
    if (isWorldTraversable(dir) || hasSearchAce(dir, group)) break;
    grantTraverse(dir, group);
    dir = path.dirname(dir);
  }
}

export function scopeAccess(targetDir: string, groupName?: string): void {
  const group = resolveGroup(groupName);
  const resolved = path.resolve(targetDir);
  scopeTargetDirectory(resolved, group);
  grantTraverseOnAncestors(resolved, group);
}

export function revokeTraverseGrants(groupName?: string): void {
  const dirs = readGrantedDirs();
  if (dirs.length === 0) return;

  const group = resolveGroup(groupName);

  for (const dir of [...dirs].reverse()) {
    try {
      if (hasSearchAce(dir, group)) {
        execFileSync('chmod', ['-a', `group:${group} allow search`, dir]);
      }
    } catch {
      // Best-effort cleanup; continue revoking remaining dirs.
    }
  }

  writeGrantedDirs([]);
}
