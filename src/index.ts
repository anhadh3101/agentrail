export { resolveUsername, resolveGroup } from './username';
export { createUserIfNotExists } from './mac/createUser';
export type { CreateUserResult } from './mac/createUser';
export { removeUserIfExists } from './mac/deleteUser';
export type { RemoveUserResult } from './mac/deleteUser';
export { scopeAccess, revokeTraverseGrants } from './mac/scopeAccess';
