/**
 * 安装级设备指纹：随机安装 ID 加稳定机器信号的摘要。
 *
 * 不采集硬件序列号；只用于同一安装的去重与限速。服务端会再做 HMAC，
 * 原始指纹不入库、不入日志。
 */
import { createHash, randomUUID } from 'node:crypto'
import { arch, hostname, platform } from 'node:os'
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'

/**
 * 读本安装的指纹。
 * @returns 64 位十六进制摘要，满足契约 32–128 字符的格式要求。
 */
export function cloudDeviceFingerprint(): string {
  let installId: string
  try {
    installId = String(getOrCreateAnonymousUserId())
  } catch {
    // 家目录不可写时仍给本次运行一个稳定值；下一次启动才会重新生成。
    installId = randomUUID()
  }
  return createHash('sha256')
    .update(`${installId}|${hostname()}|${platform()}|${arch()}`)
    .digest('hex')
}
