/**
 * 内置轨：任务归属的交付面，也是方案讨论按轨邀请技术岗位的依据。
 *
 * 轨不是岗位：轨只说明这条任务落在哪条交付面，实施阶段由人再用 `/task_assign`
 * 定具体岗位。项目可以在 `.spec/project.yaml` 的 `tracks` 里追加自己的轨，
 * 但不能占用内置轨的 id。这里没有运行时代码依赖，浏览器侧可以直接 import。
 */

/** 一条轨的描述：稳定的 id 与给人看的显示名。 */
export interface TrackDescriptor {
  readonly id: string
  readonly name: string
}

/** 内置轨；顺序即报错、展示与分组的默认顺序。 */
export const BUILTIN_TRACKS = [
  { id: 'h5', name: 'H5 前端' },
  { id: 'admin', name: '管理端' },
  { id: 'api', name: '接口' },
  { id: 'desktop', name: '桌面端' },
  { id: 'host', name: '宿主端' },
  { id: 'general', name: '通用' },
] as const

/** 内置轨 id。 */
export type BuiltinTrackId = (typeof BUILTIN_TRACKS)[number]['id']

/** 内置轨 id 集合；项目追加轨不得与它重名。 */
export const BUILTIN_TRACK_IDS: readonly string[] = BUILTIN_TRACKS.map(track => track.id)

/**
 * 这个值是不是内置轨。
 * @param value - 待判断的原始值。
 * @returns 是内置轨为 true。
 */
export function isBuiltinTrack(value: unknown): value is BuiltinTrackId {
  return typeof value === 'string' && BUILTIN_TRACK_IDS.includes(value)
}

/**
 * 内置轨的显示名。
 * @param id - 内置轨 id。
 * @returns 显示名；不是内置轨时为 undefined。
 */
export function builtinTrackName(id: string): string | undefined {
  return BUILTIN_TRACKS.find(track => track.id === id)?.name
}

/** 轨 id 的形态：小写字母开头，只含小写字母、数字、下划线与连字符。 */
export const TRACK_ID_PATTERN = /^[a-z][a-z0-9_-]*$/
