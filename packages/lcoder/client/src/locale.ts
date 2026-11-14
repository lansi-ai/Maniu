/** 新客户端词典：中文为键集合源，英文必须逐键对齐；附占位符填充。 */

import { EN } from './locale-en.ts'
import { ZH, type MessageKey } from './locale-zh.ts'

export type { MessageKey }

/** 界面语言。 */
export type LocaleId = 'zh' | 'en'

/** 可用语言；设置页按这个顺序渲染。 */
export const LOCALES: readonly LocaleId[] = ['zh', 'en']

/** 带占位符的取词函数。 */
export type Translate = (key: MessageKey, params?: Readonly<Record<string, string | number>>) => string

/**
 * 判定任意值是界面语言标识。
 * @param value - 来自存储或 IPC 的值。
 * @returns value 是 `LocaleId` 时为 true。
 */
export function isLocaleId(value: unknown): value is LocaleId {
  return value === 'zh' || value === 'en'
}

/**
 * 取一条当前语言的消息并补占位符。
 * @param locale - 当前界面语言。
 * @param key - 消息键。
 * @param params - 占位符值；缺省为原样返回。
 * @returns 可直接渲染的一句话。
 */
export function translate(
  locale: LocaleId,
  key: MessageKey,
  params?: Readonly<Record<string, string | number>>,
): string {
  const text = locale === 'en' ? EN[key] : ZH[key]
  if (params === undefined) return text
  return Object.entries(params).reduce((result, [name, value]) => result.replace(`{${name}}`, String(value)), text)
}

/**
 * 语言对应的 `<html lang>` 值。
 * @param locale - 当前界面语言。
 * @returns BCP 47 语言标签。
 */
export function localeTag(locale: LocaleId): string {
  return locale === 'en' ? 'en' : 'zh-CN'
}
