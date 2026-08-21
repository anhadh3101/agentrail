export function resolveUsername(explicitUsername?: string): string {
  if (explicitUsername) return explicitUsername;

  const envUser = process.env.OS_USER;
  if (!envUser) {
    throw new Error('Missing required environment variable: OS_USER');
  }
  return envUser;
}
