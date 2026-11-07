/**
 * Resolve the version one build publishes, which is not always the version the
 * repository declares.
 *
 * Manual Desktop CI uses UTC date, workflow run number and attempt as
 * `.YYYYMMDD.run.attempt`; these identify unpublished builds, not release sequences.
 *
 * A production release publishes the version in the manifests, aligned with the
 * `dsh` npm package. A test build publishes a version that appends a date and a
 * sequence number, so one test feed can carry several builds of a single
 * product version: `0.1.6-alpha.1.20260916.1` from a prerelease base and
 * `0.1.6-test.20260916.1` from a stable one, as the release versions table in
 * `apps/desktop/packaging/README.md#release-versions` gives them. Passing that version here keeps it out
 * of the manifests, so the tracked version stays the product's while the build
 * version reaches electron-builder, the update feed, and the upload validation
 * as one input.
 *
 * `electron-updater` compares feed versions with `semver.gt` against the
 * installed `app.getVersion()`, so validation uses the same library. Sequence
 * numbers order builds within a feed under either form. The forms differ only
 * against the base itself: builds extending a prerelease outrank it, while
 * `0.1.6-test.1` ranks below `0.1.6`, which is why the stable form belongs to a
 * test feed that never serves the production release.
 *
 * A product whose releases do not follow this repository's manifests declares its own
 * `DSH_DESKTOP_RELEASE_VERSION`, which names a version series independently instead of
 * extending the product version. The manifests keep the product version, so an upstream
 * sync never conflicts on version lines, and the release version reaches the installed
 * `app.getVersion()`, the artifact names, and the feed. One run accepts either input,
 * never both.
 */

import { parse } from 'semver'

/** Environment variable that carries the build version through one packaging and upload run. */
export const DESKTOP_BUILD_VERSION_ENV = 'DSH_DESKTOP_BUILD_VERSION'

/** Environment variable that carries a release version independent of the product version. */
export const DESKTOP_RELEASE_VERSION_ENV = 'DSH_DESKTOP_RELEASE_VERSION'

/** Prerelease field that opens a test build's suffix on a stable product version. */
const STABLE_TEST_FIELD = 'test'

/**
 * The trimmed value of one environment variable, or undefined when it is unset or blank.
 * @param {NodeJS.ProcessEnv} env - Packaging or upload environment.
 * @param {string} name - Environment variable to read.
 * @returns {string | undefined} The declared version, or undefined.
 */
function declaredVersion(env, name) {
  const value = env[name]?.trim()
  return value === undefined || value === '' ? undefined : value
}

/**
 * Parse a version the updater would accept.
 * @param {string} version - Version to read.
 * @param {string} label - Description used in failures.
 * @returns {import('semver').SemVer} The parsed version.
 */
function parseVersion(version, label) {
  const parsed = parse(version, { loose: false })
  if (parsed === null) throw new Error(`desktop build version: ${label} ${version} is not a version`)
  if (parsed.build.length > 0) {
    // Build metadata does not participate in precedence, so two builds would compare equal to the updater.
    throw new Error(`desktop build version: ${label} ${version} cannot carry build metadata`)
  }
  return parsed
}

/**
 * The prerelease fields every build version for one product version starts with.
 * @param {import('semver').SemVer} product - Parsed product version.
 * @returns {readonly (string | number)[]} Fields a build version must repeat before its date.
 */
function requiredFields(product) {
  return product.prerelease.length === 0 ? [STABLE_TEST_FIELD] : product.prerelease
}

/**
 * Validate a build version against the product version it extends.
 * @param {string} buildVersion - Version this build publishes.
 * @param {string} productVersion - Version the manifests declare.
 * @returns {string} The version as semver normalizes it, which is what the artifacts will carry.
 */
export function validateDesktopBuildVersion(buildVersion, productVersion) {
  const build = parseVersion(buildVersion, 'build version')
  const product = parseVersion(productVersion, 'product version')
  if (build.version === product.version) return build.version
  if (build.compareMain(product) !== 0) {
    throw new Error(`desktop build version: ${buildVersion} must extend product version ${productVersion}`)
  }
  const required = requiredFields(product)
  const extendsProduct = build.prerelease.length > required.length
    && required.every((field, index) => build.prerelease[index] === field)
  if (!extendsProduct) {
    throw new Error(`desktop build version: ${buildVersion} must extend ${productVersion} as ${
      desktopBuildVersionPrefix(productVersion)}<date>.<sequence> or ${
      desktopBuildVersionPrefix(productVersion)}<date>.<run>.<attempt>`)
  }
  return build.version
}

/**
 * Validate a version that names its own release series.
 * @param {string} releaseVersion - Version this release publishes.
 * @returns {string} The version as semver normalizes it, which is what the artifacts will carry.
 */
export function validateDesktopReleaseVersion(releaseVersion) {
  return parseVersion(releaseVersion, 'release version').version
}

/**
 * Resolve the version a build publishes.
 * @param {NodeJS.ProcessEnv} env - Packaging or upload environment.
 * @param {string} productVersion - Version the manifests declare.
 * @returns {string} The declared release or build version, otherwise the product version.
 * @throws {Error} When the environment declares both a release version and a build version.
 */
export function resolveDesktopBuildVersion(env, productVersion) {
  const releaseVersion = declaredVersion(env, DESKTOP_RELEASE_VERSION_ENV)
  const buildVersion = declaredVersion(env, DESKTOP_BUILD_VERSION_ENV)
  if (releaseVersion !== undefined) {
    if (buildVersion !== undefined) {
      throw new Error(`desktop build version: ${DESKTOP_RELEASE_VERSION_ENV} and ${DESKTOP_BUILD_VERSION_ENV} are alternatives`)
    }
    return validateDesktopReleaseVersion(releaseVersion)
  }
  if (buildVersion === undefined) return productVersion
  return validateDesktopBuildVersion(buildVersion, productVersion)
}

/**
 * Validate a version a completed package published against what the environment asked for.
 * @param {NodeJS.ProcessEnv} env - Packaging or upload environment.
 * @param {string} publishedVersion - Version the package record carries.
 * @param {string} productVersion - Version the manifests declare.
 * @returns {string} The published version as semver normalizes it.
 * @throws {Error} When the published version is invalid, disagrees with a declared release version,
 * or fails to extend the product version a build version belongs to.
 */
export function validateDesktopPublishedVersion(env, publishedVersion, productVersion) {
  const releaseVersion = declaredVersion(env, DESKTOP_RELEASE_VERSION_ENV)
  if (releaseVersion === undefined) return validateDesktopBuildVersion(publishedVersion, productVersion)
  const published = validateDesktopReleaseVersion(publishedVersion)
  const release = validateDesktopReleaseVersion(releaseVersion)
  if (published !== release) {
    throw new Error(`desktop build version: published ${publishedVersion} does not match release version ${release}`)
  }
  return published
}

/**
 * Everything a build version carries before its date, including the trailing separator.
 * @param {string} productVersion - Version the manifests declare.
 * @returns {string} The prefix shared by every build version of that product version.
 */
export function desktopBuildVersionPrefix(productVersion) {
  const product = parseVersion(productVersion, 'product version')
  const [release] = product.version.split('-')
  return `${release}-${requiredFields(product).join('.')}.`
}
