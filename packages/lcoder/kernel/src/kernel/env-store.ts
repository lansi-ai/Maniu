/**
 * 环境档案的读取：`.spec/env.yaml` 是命令登记与凭据引用的唯一来源。
 *
 * 读不懂就抛，不当空档案用——命令面（`cmd_run`）与部署（`/deploy`）都按这份档案说话，
 * 静默当成空档案会让「未登记的命令一律拒绝」这条闸形同虚设。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { parse as parseYaml } from 'yaml'

import { Env } from '../schema/spec.js'
import type { Command } from '../schema/spec.js'

/**
 * 读 `.spec/env.yaml`。
 * @param root - 规格根。
 * @returns 校验过的环境档案。
 */
export function loadEnv(root: string): Env {
  return Env.parse(parseYaml(readFileSync(join(root, 'env.yaml'), 'utf8')))
}

/**
 * 按 id 取登记的命令。
 * @param root - 规格根。
 * @param id - 命令 id。
 * @returns 命令定义。
 * @throws 未登记时抛出，并把可用命令与其权限档一起报出来。
 */
export function findCommand(root: string, id: string): Command {
  const env = loadEnv(root)
  const command = env.commands.find(entry => entry.id === id)
  if (command === undefined) {
    throw new Error(
      `未登记的命令：${id}。可用命令：${env.commands.map(entry => `${entry.id}(${entry.exec})`).join(', ') || '(空)'}`,
    )
  }
  return command
}
