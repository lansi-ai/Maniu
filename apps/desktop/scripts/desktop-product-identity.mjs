/**
 * Resolve the product identity one desktop package carries.
 *
 * Two families of values live here. `LCODER_RELEASE_IDENTITY` names the LCoder product, and
 * `expandLcoderReleaseSettings` is the single place that maps the public `LCODER_*` release names
 * onto the internal variables the packaging scripts read and fills the LCoder identity. The
 * resolver keeps the upstream values as its fallback, so a release environment that declares none
 * of these variables still packages the upstream product unchanged.
 */

/** Environment variable that supplies the packaged product name. */
export const DESKTOP_PRODUCT_NAME_ENV = 'DSH_DESKTOP_PRODUCT_NAME'

/** Environment variable that supplies the deep-link protocol scheme. */
export const DESKTOP_PROTOCOL_SCHEME_ENV = 'DSH_DESKTOP_PROTOCOL_SCHEME'

/** Environment variable that supplies the release artifact filename prefix. */
export const DESKTOP_ARTIFACT_PREFIX_ENV = 'DSH_DESKTOP_ARTIFACT_PREFIX'

/** Environment variable that supplies the fixed installer download filename prefix. */
export const DESKTOP_DOWNLOAD_PREFIX_ENV = 'DSH_DESKTOP_DOWNLOAD_PREFIX'

/** Environment variable that supplies the object directory of the fixed installer downloads. */
export const DESKTOP_FIXED_DOWNLOAD_DIR_ENV = 'DSH_DESKTOP_FIXED_DOWNLOAD_DIR'

/** Environment variable that supplies the download object prefix. */
export const DESKTOP_UPDATE_PREFIX_ENV = 'DSH_DESKTOP_UPDATE_PREFIX'

/** Environment variable that supplies the updater cache directory name. */
export const DESKTOP_UPDATER_CACHE_DIR_ENV = 'DSH_DESKTOP_UPDATER_CACHE_DIR'

/** Environment variable that supplies the release tag prefix. */
export const DESKTOP_RELEASE_TAG_PREFIX_ENV = 'DSH_DESKTOP_RELEASE_TAG_PREFIX'

/** Environment variable that selects an independent release version instead of a build of the product version. */
export const DESKTOP_RELEASE_VERSION_ENV = 'DSH_DESKTOP_RELEASE_VERSION'

/** Environment variable that embeds the update feed in an otherwise unsigned package. */
export const DESKTOP_UNSIGNED_UPDATER_ENV = 'DSH_DESKTOP_UNSIGNED_UPDATER'

/** Upstream identity, used when a release environment declares no product identity of its own. */
const UPSTREAM_IDENTITY = {
  productName: 'DeepSeek Harness',
  protocolScheme: 'dsh',
  artifactPrefix: 'deepseek-harness-',
  downloadPrefix: 'dsh-',
  fixedDownloadDirectory: 'desktop',
  updatePrefix: 'dsh-desk',
  updaterCacheDirName: undefined,
  releaseTagPrefix: 'desktop-v',
}

/** Maniu identity, injected for every Maniu release and local build. */
export const LCODER_RELEASE_IDENTITY = {
  appId: 'ai.lansi.lcoder',
  productName: 'Maniu',
  protocolScheme: 'lcoder',
  artifactPrefix: 'maniu-',
  downloadPrefix: 'lcoder-',
  fixedDownloadDirectory: 'lcoder-desk/latest',
  updatePrefix: 'lcoder-desk',
  updaterCacheDirName: 'lcoder-updater',
  releaseTagPrefix: 'lcoder-v',
}

/** Internal variable for each LCoder identity field except the application identifier. */
const IDENTITY_SETTINGS = {
  productName: DESKTOP_PRODUCT_NAME_ENV,
  protocolScheme: DESKTOP_PROTOCOL_SCHEME_ENV,
  artifactPrefix: DESKTOP_ARTIFACT_PREFIX_ENV,
  downloadPrefix: DESKTOP_DOWNLOAD_PREFIX_ENV,
  fixedDownloadDirectory: DESKTOP_FIXED_DOWNLOAD_DIR_ENV,
  updatePrefix: DESKTOP_UPDATE_PREFIX_ENV,
  updaterCacheDirName: DESKTOP_UPDATER_CACHE_DIR_ENV,
  releaseTagPrefix: DESKTOP_RELEASE_TAG_PREFIX_ENV,
}

/** Public and internal names for the variable that selects the update deployment. */
const UPDATE_ENVIRONMENT_ALIASES = { LCODER_UPDATE_ENV: 'DSH_DESKTOP_AUTO_UPDATE_ENV' }

/** Public release-contract names that map onto one internal variable regardless of deployment. */
const RELEASE_SETTING_ALIASES = {
  LCODER_APP_ID: 'DSH_DESKTOP_APP_ID',
  LCODER_PRODUCT_NAME: DESKTOP_PRODUCT_NAME_ENV,
  LCODER_PROTOCOL_SCHEME: DESKTOP_PROTOCOL_SCHEME_ENV,
  LCODER_UPDATE_CHANNEL: 'DSH_DESKTOP_UPDATE_CHANNEL',
  LCODER_UPDATE_PREFIX: DESKTOP_UPDATE_PREFIX_ENV,
  LCODER_RELEASE_VERSION: DESKTOP_RELEASE_VERSION_ENV,
  LCODER_UNSIGNED_UPDATER: DESKTOP_UNSIGNED_UPDATER_ENV,
  LCODER_DOWNLOAD_RELEASE_ID: 'DOWNLOAD_TEST_RELEASE_ID',
  LCODER_DOWNLOAD_EO_ZONE_ID: 'DOWNLOAD_PROD_EO_ZONE_ID',
}

function setting(env, name) {
  const value = env[name]?.trim()
  return value === '' ? undefined : value
}

function validated(name, value, pattern, expectation) {
  if (value === undefined || pattern.test(value)) return value
  throw new Error(`desktop product identity: ${name} must be ${expectation}, found ${JSON.stringify(value)}`)
}

/**
 * Resolve the identity one package carries from the internal variables a release environment
 * declares, falling back to the upstream values.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @returns {{ productName: string, protocolScheme: string, artifactPrefix: string, downloadPrefix: string, fixedDownloadDirectory: string, updatePrefix: string, updaterCacheDirName: string | undefined, releaseTagPrefix: string }} Validated identity.
 * @throws {Error} When a declared value breaks the character rules for its field.
 */
export function resolveDesktopProductIdentity(env = process.env) {
  const declared = Object.fromEntries(Object.entries(IDENTITY_SETTINGS).map(([field, name]) => [field, setting(env, name)]))
  return {
    productName: validated(DESKTOP_PRODUCT_NAME_ENV, declared.productName ?? UPSTREAM_IDENTITY.productName,
      /^[^<>:"/\\|?*$]{1,64}$/u, 'a name without path, quote, or template characters'),
    protocolScheme: validated(DESKTOP_PROTOCOL_SCHEME_ENV, declared.protocolScheme ?? UPSTREAM_IDENTITY.protocolScheme,
      /^[a-z][a-z0-9.+-]{1,31}$/u, 'a lowercase URL scheme'),
    artifactPrefix: validated(DESKTOP_ARTIFACT_PREFIX_ENV, declared.artifactPrefix ?? UPSTREAM_IDENTITY.artifactPrefix,
      /^[a-z0-9][a-z0-9._-]*-$/u, 'a lowercase filename prefix ending in a hyphen'),
    downloadPrefix: validated(DESKTOP_DOWNLOAD_PREFIX_ENV, declared.downloadPrefix ?? UPSTREAM_IDENTITY.downloadPrefix,
      /^[a-z0-9][a-z0-9._-]*-$/u, 'a lowercase filename prefix ending in a hyphen'),
    fixedDownloadDirectory: validated(DESKTOP_FIXED_DOWNLOAD_DIR_ENV, declared.fixedDownloadDirectory ?? UPSTREAM_IDENTITY.fixedDownloadDirectory,
      /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/u, 'a lowercase object directory'),
    updatePrefix: validated(DESKTOP_UPDATE_PREFIX_ENV, declared.updatePrefix ?? UPSTREAM_IDENTITY.updatePrefix,
      /^[a-z0-9][a-z0-9._-]*$/u, 'a lowercase object prefix'),
    updaterCacheDirName: validated(DESKTOP_UPDATER_CACHE_DIR_ENV, declared.updaterCacheDirName,
      /^[a-z0-9][a-z0-9._-]*$/u, 'a lowercase directory name'),
    releaseTagPrefix: validated(DESKTOP_RELEASE_TAG_PREFIX_ENV, declared.releaseTagPrefix ?? UPSTREAM_IDENTITY.releaseTagPrefix,
      /^[a-z][a-z0-9._-]*$/u, 'a lowercase tag prefix'),
  }
}

/**
 * Map the public `LCODER_*` release names onto the internal variables the packaging scripts read and
 * fill every identity field the environment leaves unset with the LCoder value. A prefix written with
 * a trailing slash is normalized to the bare prefix. Names outside the release contract, such as
 * `LCODER_SPEC_ROOT`, pass through untouched.
 * @param {NodeJS.ProcessEnv} environment - dotenv settings merged with the parent build environment.
 * @returns {NodeJS.ProcessEnv} Environment carrying internal names only; the input is not modified.
 * @throws {Error} When the deployment is unknown, when one setting arrives under its public and its
 * internal name with different values, or when a resolved identity value breaks the rules for its field.
 */
export function expandLcoderReleaseSettings(environment) {
  const env = { ...environment }
  const deployment = renamedSetting(env, UPDATE_ENVIRONMENT_ALIASES) ?? 'test'
  if (deployment !== 'test' && deployment !== 'production') {
    throw new Error('desktop product identity: the update deployment must be "test" or "production"')
  }
  const suffix = deployment === 'test' ? 'TEST' : 'PROD'
  const aliases = {
    ...RELEASE_SETTING_ALIASES,
    LCODER_UPDATE_ORIGIN: `DOWNLOAD_${suffix}_ORIGIN`,
    LCODER_DOWNLOAD_BUCKET: `DOWNLOAD_${suffix}_COS_BUCKET`,
    LCODER_DOWNLOAD_SECRET_ID: `DOWNLOAD_${suffix}_COS_SECRET_ID`,
    LCODER_DOWNLOAD_SECRET_KEY: `DOWNLOAD_${suffix}_COS_SECRET_KEY`,
  }
  for (const [publicName, internalName] of Object.entries(aliases)) renamedSetting(env, { [publicName]: internalName })
  const prefix = setting(env, DESKTOP_UPDATE_PREFIX_ENV)
  if (prefix?.endsWith('/')) env[DESKTOP_UPDATE_PREFIX_ENV] = prefix.slice(0, -1)
  for (const [field, name] of Object.entries(IDENTITY_SETTINGS)) {
    if (setting(env, name) === undefined) env[name] = LCODER_RELEASE_IDENTITY[field]
  }
  if (setting(env, 'DSH_DESKTOP_APP_ID') === undefined) env.DSH_DESKTOP_APP_ID = LCODER_RELEASE_IDENTITY.appId
  resolveDesktopProductIdentity(env)
  return env
}

/**
 * Read one setting that has both a public and an internal name, keep the internal name, and reject
 * a pair that declares different values.
 * @param {NodeJS.ProcessEnv} env - Environment being rewritten in place.
 * @param {Record<string, string>} pair - One public name mapped onto its internal name.
 * @returns {string | undefined} The value under either name, or undefined when neither is set.
 * @throws {Error} When both names carry different trimmed values.
 */
function renamedSetting(env, pair) {
  const [[publicName, internalName]] = Object.entries(pair)
  const value = setting(env, internalName)
  const alias = setting(env, publicName)
  if (value !== undefined && alias !== undefined && value !== alias) {
    throw new Error(`desktop product identity: ${publicName} conflicts with ${internalName}`)
  }
  const selected = value ?? alias
  if (selected !== undefined) env[internalName] = selected
  else delete env[internalName]
  delete env[publicName]
  return selected
}
