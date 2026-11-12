/** LCoder 主窗口的初始尺寸：优先放下向导两栏，放不下时按主屏工作区收敛。 */

/** 首选窗口尺寸，宽到能完整放下需求分析师向导的两栏。 */
const PREFERRED_SIZE = { width: 1440, height: 900 } as const

/** 工作区四周留出的边距，避免初始窗口贴边或被任务栏遮住。 */
const WORK_AREA_MARGIN = 48

/** 与 `createWindow` 的 minWidth / minHeight 一致；再小的屏幕也不缩到这条线以下。 */
const MIN_SIZE = { width: 520, height: 600 } as const

/**
 * 主窗口在给定工作区里的初始尺寸。
 *
 * 先从工作区减去边距，再收敛到首选尺寸；工作区本身比首选尺寸小时就用收敛后的值，
 * 因此小屏上窗口不会伸出工作区。工作区连最小尺寸都放不下时仍返回最小尺寸，
 * 由 `createWindow` 的最小尺寸约束兜底。
 * @param workArea - 主屏工作区尺寸（不含任务栏）。
 * @returns 初始窗口宽高。
 */
export function primaryWindowSize(
  workArea: { readonly width: number; readonly height: number },
): { readonly width: number; readonly height: number } {
  return {
    width: Math.max(MIN_SIZE.width, Math.min(PREFERRED_SIZE.width, workArea.width - WORK_AREA_MARGIN)),
    height: Math.max(MIN_SIZE.height, Math.min(PREFERRED_SIZE.height, workArea.height - WORK_AREA_MARGIN)),
  }
}
