/**
 * Checks if user name is provided in the environment file, otherwise initializes an agentrail user in the dscl.
 * @param explicitGroup Name of the user
 * @returns Name of the user
 */
export function resolveUsername(explicitUsername?: string): string {
  if (explicitUsername !== undefined) return explicitUsername;

  const envUser = process.env.AGENT_USERNAME || 'agentrail';
  return envUser;
}

/**
 * Checks if group name is provided in the environment file, otherwise initializes an agentrail-group in the dscl.
 * @param explicitGroup Name of the user group
 * @returns Name of the user group
 */
export function resolveGroup(explicitGroup?: string): string {
  if (explicitGroup !== undefined) return explicitGroup;

  const envGroup = process.env.AGENT_GROUP || 'agentrail-group';
  return envGroup;
}

/**
 * Checks if app name is provided in the environment file, otherwise initializes an agentrail config directory in macOS Home
 * @param explicitAppName Name of the app
 * @returns Name of the app
 */
export function resolveAppName(explicitAppName?: string): string {
  const appName =
    explicitAppName !== undefined ? explicitAppName : process.env.APP_NAME || 'agentrail';

  if (appName.includes('/') || appName.includes('\\') || appName === '.' || appName === '..') {
    throw new Error(
      `Invalid APP_NAME '${appName}': must be a single directory name with no path separators.`,
    );
  }
  return appName;
}
