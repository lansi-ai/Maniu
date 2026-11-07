/** Environment variable that carries the build version through one packaging and upload run. */
export const DESKTOP_BUILD_VERSION_ENV: 'DSH_DESKTOP_BUILD_VERSION'

/** Environment variable that carries a release version independent of the product version. */
export const DESKTOP_RELEASE_VERSION_ENV: 'DSH_DESKTOP_RELEASE_VERSION'

/**
 * Validate a build version against the product version it extends.
 * @param buildVersion - Version this build publishes.
 * @param productVersion - Version the manifests declare.
 * @returns The version as semver normalizes it, which is what the artifacts will carry.
 */
export function validateDesktopBuildVersion(buildVersion: string, productVersion: string): string

/**
 * Validate a version that names its own release series.
 * @param releaseVersion - Version this release publishes.
 * @returns The version as semver normalizes it, which is what the artifacts will carry.
 */
export function validateDesktopReleaseVersion(releaseVersion: string): string

/**
 * Resolve the version a build publishes.
 * @param env - Packaging or upload environment.
 * @param productVersion - Version the manifests declare.
 * @returns The declared release or build version, otherwise the product version.
 * @throws When the environment declares both a release version and a build version.
 */
export function resolveDesktopBuildVersion(env: NodeJS.ProcessEnv, productVersion: string): string

/**
 * Validate a version a completed package published against what the environment asked for.
 * @param env - Packaging or upload environment.
 * @param publishedVersion - Version the package record carries.
 * @param productVersion - Version the manifests declare.
 * @returns The published version as semver normalizes it.
 * @throws When the published version is invalid, disagrees with a declared release version, or fails to
 * extend the product version a build version belongs to.
 */
export function validateDesktopPublishedVersion(
  env: NodeJS.ProcessEnv,
  publishedVersion: string,
  productVersion: string,
): string

/**
 * Everything a build version carries before its date, including the trailing separator.
 * @param productVersion - Version the manifests declare.
 * @returns The prefix shared by every build version of that product version.
 */
export function desktopBuildVersionPrefix(productVersion: string): string
