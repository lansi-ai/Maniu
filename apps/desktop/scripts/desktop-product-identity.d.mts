/** Resolve the product identity one desktop package carries. */

/** Environment variable that supplies the packaged product name. */
export const DESKTOP_PRODUCT_NAME_ENV: 'DSH_DESKTOP_PRODUCT_NAME'

/** Environment variable that supplies the deep-link protocol scheme. */
export const DESKTOP_PROTOCOL_SCHEME_ENV: 'DSH_DESKTOP_PROTOCOL_SCHEME'

/** Environment variable that supplies the release artifact filename prefix. */
export const DESKTOP_ARTIFACT_PREFIX_ENV: 'DSH_DESKTOP_ARTIFACT_PREFIX'

/** Environment variable that supplies the fixed installer download filename prefix. */
export const DESKTOP_DOWNLOAD_PREFIX_ENV: 'DSH_DESKTOP_DOWNLOAD_PREFIX'

/** Environment variable that supplies the download object prefix. */
export const DESKTOP_UPDATE_PREFIX_ENV: 'DSH_DESKTOP_UPDATE_PREFIX'

/** Environment variable that supplies the updater cache directory name. */
export const DESKTOP_UPDATER_CACHE_DIR_ENV: 'DSH_DESKTOP_UPDATER_CACHE_DIR'

/** Environment variable that supplies the release tag prefix. */
export const DESKTOP_RELEASE_TAG_PREFIX_ENV: 'DSH_DESKTOP_RELEASE_TAG_PREFIX'

/** Environment variable that selects an independent release version instead of a build of the product version. */
export const DESKTOP_RELEASE_VERSION_ENV: 'DSH_DESKTOP_RELEASE_VERSION'

/** Environment variable that embeds the update feed in an otherwise unsigned package. */
export const DESKTOP_UNSIGNED_UPDATER_ENV: 'DSH_DESKTOP_UNSIGNED_UPDATER'

/** Identity one package carries, after environment variables are validated. */
export interface DesktopProductIdentity {
  readonly productName: string
  readonly protocolScheme: string
  readonly artifactPrefix: string
  readonly downloadPrefix: string
  readonly updatePrefix: string
  readonly updaterCacheDirName: string | undefined
  readonly releaseTagPrefix: string
}

/** LCoder identity supplied to the packaging scripts by `expandLcoderReleaseSettings`. */
export const LCODER_RELEASE_IDENTITY: DesktopProductIdentity & { readonly appId: string }

/**
 * Resolve the identity one package carries from the internal variables a release environment declares,
 * falling back to the upstream values.
 * @param env - Packaging environment.
 * @returns Validated identity.
 * @throws When a declared value breaks the character rules for its field.
 */
export function resolveDesktopProductIdentity(env?: NodeJS.ProcessEnv): DesktopProductIdentity

/**
 * Map the public `LCODER_*` release names onto the internal variables the packaging scripts read and
 * fill every identity field the environment leaves unset with the LCoder value.
 * @param environment - dotenv settings merged with the parent build environment.
 * @returns Environment carrying internal names only; the input is not modified.
 * @throws When the deployment is unknown or when one setting arrives under its public and its internal
 * name with different values.
 */
export function expandLcoderReleaseSettings(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv
