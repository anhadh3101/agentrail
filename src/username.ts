export function resolveUsername(explicitUsername?: string): string {
  if (explicitUsername) return explicitUsername;

  const envUser = process.env.AGENT_USERNAME;
  if (!envUser) {
    throw new Error('Missing required environment variable: AGENT_USERNAME');
  }
  return envUser;
}

export function resolveGroup(explicitGroup?: string): string {
  if (explicitGroup) return explicitGroup;

  const envGroup = process.env.AGENT_GROUP;
  if (!envGroup) {
    throw new Error('Missing required environment variable: AGENT_GROUP');
  }
  return envGroup;
}
