/**
 * Windows 打包配置：electron-builder 26 的静态配置面。
 *
 * 这里只放与产物身份、目录布局有关的常量；staging、载荷与版本由
 * `scripts/package-win.mjs` 解析后合并进来。首版不带自动更新：`publish` 为 null，
 * 也不打 electron-updater 依赖。
 */

import { cpSync } from 'node:fs'
import { join } from 'node:path'

/** 包目录：`packages/lcoder/desktop`。 */
export const PACKAGE_ROOT = join(import.meta.dirname, '..')

/** 构建中间目录；不入库。 */
export const BUILD_ROOT = join(PACKAGE_ROOT, '.desktop-build')

/** 安装包与 win-unpacked 的输出目录。 */
export const ARTIFACTS_DIR = join(BUILD_ROOT, 'artifacts')

/** Maniu 发布身份：appId、产品名、协议与产物前缀。 */
export const IDENTITY = {
  appId: 'ai.lansi.lcoder',
  productName: 'Maniu',
  protocolScheme: 'lcoder',
  artifactPrefix: 'maniu-',
  updaterCacheDirName: 'lcoder-updater',
}

/** NSIS 安装向导语言；与旧壳的 8 种安装界面语言一致。 */
export const INSTALLER_LANGUAGES = ['en_US', 'zh_CN', 'ja_JP', 'es_ES', 'fr_FR', 'de_DE', 'ru_RU', 'pt_BR']

/**
 * 组装 electron-builder 配置。
 * @param options - staging 目录、载荷目录与发布版本。
 * @returns electron-builder `Configuration`。
 */
export function createWindowsConfig(options) {
  const { appDir, deployDir, profileDir, clientDistDir, iconPath, trayPath, runtimeDir, version, electronVersion, electronDist } = options
  return {
    appId: IDENTITY.appId,
    productName: IDENTITY.productName,
    copyright: 'Copyright © 2026 Maniu',
    artifactName: `${IDENTITY.artifactPrefix}\${version}-win-\${arch}-unsigned.\${ext}`,
    directories: { app: appDir, output: ARTIFACTS_DIR },
    electronVersion,
    electronDist,
    // 发布态唯一入口：host-entry 用 `process.execPath` + ELECTRON_RUN_AS_NODE 起宿主。
    electronFuses: { runAsNode: true },
    protocols: [{ name: IDENTITY.productName, schemes: [IDENTITY.protocolScheme] }],
    extraMetadata: { version, updaterCacheDirName: IDENTITY.updaterCacheDirName },
    asar: true,
    npmRebuild: false,
    buildDependenciesFromSource: false,
    files: ['lib/**/*.js', 'lib/preload.cjs', 'package.json', '!**/*.map', '!**/*.d.ts'],
    extraResources: [
      { from: profileDir, to: 'profile', filter: ['*.yml'] },
      { from: clientDistDir, to: 'client-dist', filter: ['**/*'] },
      { from: iconPath, to: 'icon.png' },
      { from: trayPath, to: 'tray.ico' },
      ...(runtimeDir === undefined ? [] : [
        { from: join(runtimeDir, 'primary-runtime'), to: 'runtime/primary-runtime' },
        {
          from: join(runtimeDir, 'primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'),
          to: 'runtime/bin/node.exe',
        },
      ]),
    ],
    win: {
      icon: iconPath,
      target: ['nsis'],
      forceCodeSigning: false,
    },
    nsis: {
      oneClick: false,
      perMachine: false,
      allowElevation: false,
      allowToChangeInstallationDirectory: false,
      differentialPackage: true,
      installerLanguages: INSTALLER_LANGUAGES,
      uninstallDisplayName: '${productName}',
    },
    // electron-builder 的 extraResources 会跳过任何 node_modules 目录；宿主依赖树
    // 改在 afterPack 里整体复制。NSIS 的 7z 不接受链接，这里展开成实体目录。
    afterPack: async context => {
      cpSync(deployDir, join(context.appOutDir, 'resources', 'dsh'), { recursive: true, dereference: true })
    },
    // 首版不接更新 feed；electron-updater 不在依赖里。
    publish: null,
    detectUpdateChannel: false,
  }
}
