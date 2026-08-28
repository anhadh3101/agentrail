/**
 * Checks if user name is provided in the environment file, otherwise initializes an agentrail user in the dscl.
 * @param explicitGroup Name of the user
 * @returns Name of the user
 */
export function resolveUsername(explicitUsername?: string): string {
  if (explicitUsername) return explicitUsername;

  const envUser = process.env.AGENT_USERNAME || 'agentrail';
  return envUser;
}

/**
 * Checks if group name is provided in the environment file, otherwise initializes an agentrail-group in the dscl.
 * @param explicitGroup Name of the user group
 * @returns Name of the user group
 */
export function resolveGroup(explicitGroup?: string): string {
  if (explicitGroup) return explicitGroup;

  const envGroup = process.env.AGENT_GROUP || 'agentrail-group';
  return envGroup;
}

/**
 * Checks if app name is provided in the environment file, otherwise initializes an agentrail config directory in macOS Home
 * @param explicitAppName Name of the app
 * @returns Name of the app
 */
export function resolveAppName(explicitAppName?: string): string {
  if (explicitAppName) return explicitAppName;

  const appName = process.env.APP_NAME || 'agentrail'
  return appName;
}
