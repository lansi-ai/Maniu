import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { AppInfo, Packager } from 'app-builder-lib'
import { expandMacro } from 'app-builder-lib/out/util/macroExpander.js'
import { describe, expect, it } from 'vitest'
import {
  DESKTOP_ARTIFACT_PREFIX_ENV,
  DESKTOP_PROTOCOL_SCHEME_ENV,
  DESKTOP_UPDATE_PREFIX_ENV,
  expandLcoderReleaseSettings,
  resolveDesktopProductIdentity,
} from '../scripts/desktop-product-identity.mjs'
import { desktopLatestInstallerFilename, resolveDesktopAutoUpdateConfig } from '../scripts/desktop-auto-update-environment.mjs'
import {
  DESKTOP_BUILD_VERSION_ENV,
  DESKTOP_RELEASE_VERSION_ENV,
  resolveDesktopBuildVersion,
  validateDesktopPublishedVersion,
} from '../scripts/desktop-build-version.mjs'
import { desktopReleaseTag } from '../scripts/desktop-release-tag.ts'
import { desktopUpdateChannel } from '../src/update-channel.ts'

const RELEASE_ID = '0123456789abcdef0123456789abcdef'
const PRODUCT_VERSION = '0.2.2-alpha.2'

/** One LCoder release environment, built the way the package environment loader builds it. */
function lcoderEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return expandLcoderReleaseSettings({
    LCODER_UPDATE_ORIGIN: 'https://download.example.com',
    LCODER_DOWNLOAD_RELEASE_ID: RELEASE_ID,
    LCODER_RELEASE_VERSION: '0.1.0',
    DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN: 'https://policy.example.com',
    DSH_DESKTOP_TARGET_PLATFORM: 'win32',
    DSH_DESKTOP_TARGET_ARCH: 'x64',
    DSH_DESKTOP_UNSIGNED: '1',
    ...overrides,
  })
}

async function builderConfig(environment: NodeJS.ProcessEnv) {
  const { createElectronBuilderConfig } = await import('../scripts/electron-builder-config.mjs')
  return createElectronBuilderConfig(environment, 'win32', 'x64')
}

describe('LCoder product identity', () => {
  it('keeps the upstream identity when a release environment declares none', () => {
    expect(resolveDesktopProductIdentity({})).toEqual({
      productName: 'DeepSeek Harness',
      protocolScheme: 'dsh',
      artifactPrefix: 'deepseek-harness-',
      downloadPrefix: 'dsh-',
      updatePrefix: 'dsh-desk',
      updaterCacheDirName: undefined,
      releaseTagPrefix: 'desktop-v',
    })
  })

  it('maps the release contract onto internal names and fills the LCoder identity', () => {
    const env = lcoderEnvironment()
    expect(env).toMatchObject({
      DSH_DESKTOP_APP_ID: 'ai.lansi.lcoder',
      DSH_DESKTOP_PRODUCT_NAME: 'LCoder',
      DSH_DESKTOP_PROTOCOL_SCHEME: 'lcoder',
      DSH_DESKTOP_ARTIFACT_PREFIX: 'lcoder-',
      DSH_DESKTOP_DOWNLOAD_PREFIX: 'lcoder-',
      DSH_DESKTOP_UPDATE_PREFIX: 'lcoder-desk',
      DSH_DESKTOP_UPDATER_CACHE_DIR: 'lcoder-updater',
      DSH_DESKTOP_RELEASE_TAG_PREFIX: 'lcoder-v',
      DSH_DESKTOP_RELEASE_VERSION: '0.1.0',
      DOWNLOAD_TEST_ORIGIN: 'https://download.example.com',
      DOWNLOAD_TEST_RELEASE_ID: RELEASE_ID,
    })
    expect(Object.keys(env).filter(name => name.startsWith('LCODER_'))).toEqual([])
  })

  it('passes settings outside the release contract through untouched', () => {
    expect(lcoderEnvironment({ LCODER_SPEC_ROOT: 'E:/Projects/Demo' }).LCODER_SPEC_ROOT).toBe('E:/Projects/Demo')
  })

  it('routes the origin and bucket settings to the selected deployment', () => {
    const production = expandLcoderReleaseSettings({
      LCODER_UPDATE_ENV: 'production', LCODER_UPDATE_ORIGIN: 'https://download.example.com', LCODER_DOWNLOAD_BUCKET: 'lcoder-download-1250000000',
    })
    expect(production).toMatchObject({
      DSH_DESKTOP_AUTO_UPDATE_ENV: 'production',
      DOWNLOAD_PROD_ORIGIN: 'https://download.example.com',
      DOWNLOAD_PROD_COS_BUCKET: 'lcoder-download-1250000000',
    })
    expect(production.DOWNLOAD_TEST_ORIGIN).toBeUndefined()
  })

  it.each([undefined, '   '])('treats an empty release setting %j as unset', (value) => {
    const env = expandLcoderReleaseSettings({ LCODER_APP_ID: value })
    expect(env.DSH_DESKTOP_APP_ID).toBe('ai.lansi.lcoder')
  })

  it.each([
    ['LCODER_APP_ID and DSH_DESKTOP_APP_ID disagree', { LCODER_APP_ID: 'ai.lansi.lcoder', DSH_DESKTOP_APP_ID: 'com.example.other' }],
    ['LCODER_UPDATE_ORIGIN and DOWNLOAD_TEST_ORIGIN disagree', { LCODER_UPDATE_ORIGIN: 'https://a.example.com', DOWNLOAD_TEST_ORIGIN: 'https://b.example.com' }],
    ['an unknown deployment', { LCODER_UPDATE_ENV: 'staging' }],
    ['an uppercase protocol scheme', { LCODER_PROTOCOL_SCHEME: 'LCoder' }],
  ])('rejects when %s', (_label, overrides) => {
    expect(() => expandLcoderReleaseSettings(overrides as NodeJS.ProcessEnv)).toThrow()
  })

  it.each([
    [DESKTOP_PROTOCOL_SCHEME_ENV, 'LCoder', /lowercase URL scheme/u],
    [DESKTOP_ARTIFACT_PREFIX_ENV, 'lcoder', /ending in a hyphen/u],
    [DESKTOP_UPDATE_PREFIX_ENV, 'lcoder desk', /lowercase object prefix/u],
  ])('rejects an invalid %s %j', (name, value, expectation) => {
    expect(() => resolveDesktopProductIdentity({ [name]: value })).toThrow(expectation)
  })

  it('normalizes an object prefix written with a trailing slash', () => {
    expect(expandLcoderReleaseSettings({ LCODER_UPDATE_PREFIX: 'lcoder-desk/' }).DSH_DESKTOP_UPDATE_PREFIX).toBe('lcoder-desk')
  })
})

describe('LCoder packaged configuration', () => {
  it('seals the LCoder identity into the Windows package', async () => {
    const config = await builderConfig(lcoderEnvironment())
    expect(config).toMatchObject({
      appId: 'ai.lansi.lcoder',
      productName: 'LCoder',
      protocols: [{ name: 'LCoder', schemes: ['lcoder'] }],
      updaterCacheDirName: 'lcoder-updater',
    })
    expect(config.artifactName).toBe('lcoder-${version}-${os}-${arch}-unsigned.${ext}')
    expect(config.extraMetadata).toMatchObject({
      version: '0.1.0',
      dshDesktopAppId: 'ai.lansi.lcoder',
      dshDesktopProtocolScheme: 'lcoder',
      dshDesktopUpdateChannel: 'nightly',
    })
    expect(desktopUpdateChannel(config.extraMetadata)).toBe('nightly')
    const packager = new Packager({ projectDir: tmpdir() })
    Object.defineProperties(packager, {
      config: { value: config },
      metadata: { value: JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) },
    })
    const appInfo = new AppInfo(packager, undefined)
    expect(appInfo.productFilename).toBe('LCoder')
    expect(expandMacro(config.nsis.uninstallDisplayName, null, appInfo, {}, false)).toBe('LCoder')
    expect(appInfo.copyright).toBe(`Copyright © ${new Date().getFullYear()} LCoder`)
  })

  it('names the update feed after the target directory under the configured prefix', async () => {
    const environment = lcoderEnvironment()
    expect(resolveDesktopAutoUpdateConfig(environment, 'win32', 'x64')).toMatchObject({
      keyPrefix: `lcoder-desk/${RELEASE_ID}/feeds/win-x64`,
      publicUrl: `https://download.example.com/lcoder-desk/${RELEASE_ID}/feeds/win-x64/`,
    })
    const config = await builderConfig(lcoderEnvironment({ LCODER_UNSIGNED_UPDATER: '1' }))
    expect(config.publish).toEqual([{
      provider: 'generic',
      url: `https://download.example.com/lcoder-desk/${RELEASE_ID}/feeds/win-x64/`,
      channel: 'nightly',
    }])
  })

  it('publishes no feed for an unsigned package unless the internal opt-in is set', async () => {
    expect((await builderConfig(lcoderEnvironment())).publish).toBeNull()
    expect((await builderConfig(lcoderEnvironment({ LCODER_UNSIGNED_UPDATER: '0' }))).publish).toBeNull()
    const opted = await builderConfig(lcoderEnvironment({ LCODER_UNSIGNED_UPDATER: '1' }))
    expect(opted.extraMetadata.dshDesktopUpdateChannel).toBe('nightly')
  })

  it('rejects an unsigned updater switch that is neither 0 nor 1', async () => {
    await expect(builderConfig(lcoderEnvironment({ LCODER_UNSIGNED_UPDATER: 'yes' }))).rejects.toThrow(/UNSIGNED_UPDATER/u)
  })

  it('accepts a prerelease on nightly and rejects one on latest', async () => {
    const prerelease = '0.1.1-nightly.20261106.1'
    const nightly = await builderConfig(lcoderEnvironment({ LCODER_RELEASE_VERSION: prerelease }))
    expect(nightly.extraMetadata.version).toBe(prerelease)
    await expect(builderConfig(lcoderEnvironment({
      LCODER_RELEASE_VERSION: prerelease, LCODER_UPDATE_CHANNEL: 'latest', LCODER_UNSIGNED_UPDATER: '1',
    }))).rejects.toThrow(/latest requires a stable version/u)
    const stable = await builderConfig(lcoderEnvironment({
      LCODER_RELEASE_VERSION: '0.1.1', LCODER_UPDATE_CHANNEL: 'latest', LCODER_UNSIGNED_UPDATER: '1',
    }))
    expect(stable).toMatchObject({ publish: [{ channel: 'latest' }] })
    expect(stable.extraMetadata.version).toBe('0.1.1')
  })
})

describe('LCoder release version and names', () => {
  it('publishes a release version that does not extend the product version', () => {
    expect(resolveDesktopBuildVersion({ [DESKTOP_RELEASE_VERSION_ENV]: '0.1.0' }, PRODUCT_VERSION)).toBe('0.1.0')
    expect(resolveDesktopBuildVersion({ [DESKTOP_RELEASE_VERSION_ENV]: 'v0.1.0' }, PRODUCT_VERSION)).toBe('0.1.0')
    expect(resolveDesktopBuildVersion({ [DESKTOP_RELEASE_VERSION_ENV]: '0.1.1-nightly.20261106.1' }, PRODUCT_VERSION))
      .toBe('0.1.1-nightly.20261106.1')
  })

  it('keeps the product version when no release version is declared', () => {
    expect(resolveDesktopBuildVersion({}, PRODUCT_VERSION)).toBe(PRODUCT_VERSION)
    expect(resolveDesktopBuildVersion({ [DESKTOP_RELEASE_VERSION_ENV]: '  ' }, PRODUCT_VERSION)).toBe(PRODUCT_VERSION)
  })

  it.each([
    ['both versions', { [DESKTOP_RELEASE_VERSION_ENV]: '0.1.0', [DESKTOP_BUILD_VERSION_ENV]: `${PRODUCT_VERSION}.20261106.1` }, /alternatives/u],
    ['not a version', { [DESKTOP_RELEASE_VERSION_ENV]: '0.1' }, /is not a version/u],
    ['build metadata', { [DESKTOP_RELEASE_VERSION_ENV]: '0.1.0+20261106' }, /build metadata/u],
  ])('rejects %s', (_label, environment, expectation) => {
    expect(() => resolveDesktopBuildVersion(environment, PRODUCT_VERSION)).toThrow(expectation)
  })

  it('accepts a recorded version matching the release version and rejects any other', () => {
    const environment = { [DESKTOP_RELEASE_VERSION_ENV]: '0.1.0' }
    expect(validateDesktopPublishedVersion(environment, '0.1.0', PRODUCT_VERSION)).toBe('0.1.0')
    expect(() => validateDesktopPublishedVersion(environment, '0.2.0', PRODUCT_VERSION)).toThrow(/does not match release version/u)
    expect(validateDesktopPublishedVersion({}, `${PRODUCT_VERSION}.20261106.1`, PRODUCT_VERSION)).toBe(`${PRODUCT_VERSION}.20261106.1`)
  })

  it('names fixed downloads and release tags with the LCoder prefixes', () => {
    const environment = lcoderEnvironment()
    expect(desktopLatestInstallerFilename('win-x64', environment)).toBe('lcoder-latest-windows-x64.exe')
    expect(desktopLatestInstallerFilename('mac-arm64', environment)).toBe('lcoder-latest-macos-arm64.dmg')
    expect(desktopReleaseTag('0.1.0', environment)).toBe('lcoder-v0.1.0')
  })

  it('keeps the upstream names for an environment with no identity', () => {
    expect(desktopLatestInstallerFilename('win-x64', {})).toBe('dsh-latest-windows-x64.exe')
    expect(desktopReleaseTag('0.1.0', {})).toBe('desktop-v0.1.0')
  })
})
