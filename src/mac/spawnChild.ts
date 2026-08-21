import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { resolveUsername } from '../username';

export function isCodegoatChild(username?: string): boolean {
  return os.userInfo().username === resolveUsername(username);
}

function resolveCliInvocation(entryPointOverride?: string): string[] {
  if (entryPointOverride) {
    if (!fs.existsSync(entryPointOverride)) {
      throw new Error(`CodeGoat entry point not found at: ${entryPointOverride}`);
    }
    return [process.execPath, entryPointOverride];
  }

  const runningEntry = process.argv[1];
  if (runningEntry && fs.existsSync(runningEntry)) {
    return [process.execPath, runningEntry];
  }

  throw new Error(
    'Unable to resolve the CodeGoat CLI entry point. Pass an explicit entryPoint ' +
      'to spawnChildProcess({ entryPoint }) or ensure process.argv[1] points at a built file.',
  );
}

export interface SpawnChildResult {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface SpawnChildOptions {
  username?: string;
  entryPoint?: string;
}

export function spawnChildProcess(options: SpawnChildOptions = {}): Promise<SpawnChildResult> {
  const targetUser = resolveUsername(options.username);
  const cliArgs = resolveCliInvocation(options.entryPoint);

  return new Promise((resolve, reject) => {
    const child = spawn(
      'sudo',
      ['-u', targetUser, '-E', ...cliArgs],
      {
        stdio: 'inherit',
        env: { ...process.env },
      },
    );

    child.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error('sudo not found. CodeGoat requires sudo to run as the codegoat user.'));
        return;
      }
      reject(err);
    });

    child.on('exit', (code, signal) => {
      resolve({
        code: code ?? null,
        signal: signal ?? null,
      });
    });
  });
}
