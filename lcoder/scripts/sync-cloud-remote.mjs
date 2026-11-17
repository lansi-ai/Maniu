#!/usr/bin/env node
/**
 * 把宿主生成的 `@maniu/kernel` Remote 贡献同步进工作台源码。
 *
 * 浏览器包只认仓库内的相对模块，不能把 `@maniu/kernel/remote` 当模块表行；
 * 同时单测要在没有 lib 产物的干净检出里跑，所以生成的贡献固化进 `src`。
 *
 * 用法（仓库根）：
 *   pnpm exec tsx scripts/generate-typert.ts && node lcoder/scripts/sync-cloud-remote.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const source = join(root, 'packages/lcoder/kernel/lib/typert.remote-client.js')
const target = join(root, 'packages/lcoder/workspace/src/client/cloud/remote.generated.ts')

const header = [
  '/* oxlint-disable */',
  '// @ts-nocheck',
  '// Copied from packages/lcoder/kernel/lib/typert.remote-client.js by lcoder/scripts/sync-cloud-remote.mjs.',
  '// Regenerate with: pnpm exec tsx scripts/generate-typert.ts && node lcoder/scripts/sync-cloud-remote.mjs',
  '',
].join('\n')

const body = readFileSync(source, 'utf8')
writeFileSync(target, `${header}${body}`, 'utf8')
console.log(`synced ${target}`)
