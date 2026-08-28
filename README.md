# agentrail

macOS sandboxing primitives for agent tooling: create and remove a restricted
Directory Services user/group, and scope filesystem access to that group with
ACLs that can be fully revoked later.

It exists so a CLI can run untrusted agent work as a low-privilege macOS user
that only has access to an explicitly granted directory tree — and can undo
every change on teardown.

## Requirements

- **macOS** — every mutating function throws on non-Darwin platforms.
- **Node.js ≥ 18** (uses `node:`-prefixed built-ins and modern syntax).
- **`sudo`** — user/group creation and deletion shell out to `sudo dscl`, and
  `scopeAccess` / `revokeTraverseGrants` run `chmod +a`. Run in a context where
  `sudo` is available (it inherits stdio, so a TTY password prompt works).

The package ships compiled JavaScript plus `.d.ts` types in `dist/`.

## Install

```sh
npm install @codegoat-cli/agentrail
```

## Usage

### CommonJS

```js
const {
  createUserIfNotExists,
  scopeAccess,
  revokeTraverseGrants,
  removeUserIfExists,
  removeGroupIfExists,
} = require('@codegoat-cli/agentrail');
```

### TypeScript / ESM

```ts
import {
  createUserIfNotExists,
  scopeAccess,
  revokeTraverseGrants,
  removeUserIfExists,
  removeGroupIfExists,
} from '@codegoat-cli/agentrail';
```

### Full lifecycle

```ts
import {
  createUserIfNotExists,
  scopeAccess,
  revokeTraverseGrants,
  removeUserIfExists,
  removeGroupIfExists,
} from '@codegoat-cli/agentrail';

// 1. Provision the sandbox user (also creates the group and adds you + the
//    new user to it). No-op if the user already exists.
const { created } = createUserIfNotExists();          // uses AGENT_USERNAME / default

// 2. Give the sandbox group full recursive access to one directory, and
//    traverse-only access to every ancestor up to '/'. The granted ACEs are
//    recorded in ~/.<APP_NAME>/granted-dirs.json.
scopeAccess('/Users/me/projects/agent-workspace');

//    ... run the sandboxed work as the sandbox user ...

// 3. Teardown. Order matters: revoke ACLs BEFORE deleting the group — once the
//    group record is gone, the ACE can no longer be resolved by name.
revokeTraverseGrants();
removeUserIfExists();
removeGroupIfExists();
```

## Configuration

Names are resolved in this order: **explicit argument → environment variable →
default**.

| Setting    | Env var          | Default            |
| ---------- | ---------------- | ------------------ |
| Username   | `AGENT_USERNAME` | `agentrail`        |
| Group name | `AGENT_GROUP`    | `agentrail-group`  |
| App name   | `APP_NAME`       | `agentrail`        |

`APP_NAME` only affects where `scopeAccess` persists its grant state:
`~/.<APP_NAME>/granted-dirs.json`.

Importing the module does **not** require any of these to be set.

## API

### `resolveUsername(explicit?) → string`
### `resolveGroup(explicit?) → string`
### `resolveAppName(explicit?) → string`

Pure helpers that apply the resolution order above. Useful for logging what a
call will act on before making it.

### `createUserIfNotExists(username?) → { created: boolean }`

Creates a restricted user (`/usr/bin/false` shell, `/var/empty` home,
authentication disabled, random discarded password). Ensures the group exists
first and adds both the new user and the invoking admin to it. Returns
`{ created: false }` if the user record already exists.

- UID is the first free id `≥ 601`; GID the first free id `≥ 701`.
- Throws on a non-macOS platform or a syntactically invalid username.

### `removeUserIfExists(username?) → { userRemoved: boolean }`

Deletes the user record. Returns `{ userRemoved: false }` if it does not exist.
**Refuses** (throws) if the record's UID is below `601`, on the assumption that
it is not an agentrail-managed account. Does not touch the group.

### `createGroupIfNotExists(groupName?) → { created: boolean, gid: number }`

Creates the group with the first free GID `≥ 701`. If it already exists,
returns `{ created: false, gid }` with the existing `PrimaryGroupID`.

### `removeGroupIfExists(groupName?) → { groupRemoved: boolean }`

Deletes the group record. Returns `{ groupRemoved: false }` if it does not
exist. **Refuses** (throws) if the GID is below `701`.

### `scopeAccess(targetDir, groupName?) → void`

Grants the sandbox group:

- a recursive ACL on `targetDir` with full read/write/execute plus inherit
  flags (so files created later under it are covered), and
- a traverse-only (`search`) ACE on every ancestor directory up to `/` that is
  not already world-traversable.

`targetDir` is resolved to an absolute path. Every granted directory is
recorded so it can be revoked later. Idempotent — re-running skips directories
that already carry the ACE.

### `revokeTraverseGrants(groupName?) → void`

Strips every ACE previously recorded by `scopeAccess` (targets recursively,
ancestors individually), then clears the state file. Best-effort: a failure on
one directory does not stop the rest. No-op if nothing was recorded.

Call this **before** `removeGroupIfExists` during teardown.

### Types

`CreateUserResult`, `RemoveUserResult`, `CreateGroupResult`, `RemoveGroupResult`
are exported for consumers that want to annotate return values.

## Development

```sh
npm install
npm run build        # tsc -> dist/
npm test             # node:test suite via tsx
npm run test:watch
```

Tests mock `child_process` and never touch the real Directory Services, so they
are safe to run on any machine — though the code under test only *runs* on
macOS.

## License

ISC
