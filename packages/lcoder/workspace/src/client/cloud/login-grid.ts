/**
 * 登录页背景底纹的纯几何：高斯影响、顶点位移、亮度混合、梅花姿态与 CSS 颜色解析。
 *
 * 组件只负责采样、配色与 canvas 绘制；这里的函数不碰 DOM，可以单独测。
 */

/** 底纹类型：`grid` 是细网格线，`plum` 是散落的五瓣梅花。 */
export type BackdropMotif = 'grid' | 'plum'

/** 指针影响的形状参数，单位都是 CSS 像素。 */
export interface GridWarpSpec {
  /** 高斯影响的标准差；越大，隆起范围越宽。 */
  readonly sigma: number
  /** 指针处向外的最大放大比例；0 表示不做透视外扩。 */
  readonly perspective: number
  /** 指针处的最大抬升；叠加在透视外扩之上。 */
  readonly lift: number
}

/** 一个网格顶点的位移结果。 */
export interface GridVertex {
  /** 位移后的横坐标。 */
  readonly x: number
  /** 位移后的纵坐标。 */
  readonly y: number
  /** 高斯影响权重 0–1；同时作为线条亮度系数。 */
  readonly glow: number
}

/** 解析后的 CSS 颜色，各通道 0–255，透明度 0–1。 */
export interface GridColor {
  /** 红色通道。 */
  readonly r: number
  /** 绿色通道。 */
  readonly g: number
  /** 蓝色通道。 */
  readonly b: number
  /** 透明度。 */
  readonly alpha: number
}

/**
 * 把输入夹到 0–1。
 * @param value - 任意数字。
 * @returns 0–1 之间的值；NaN 视为 0。
 */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/**
 * 高斯影响权重：指针处为 1，随距离平方指数衰减。
 * @param dx - 顶点相对指针的横向距离。
 * @param dy - 顶点相对指针的纵向距离。
 * @param sigma - 高斯标准差；非正数时没有影响。
 * @returns 0–1 之间的影响权重。
 */
export function gridInfluence(dx: number, dy: number, sigma: number): number {
  if (!(sigma > 0)) return 0
  return Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma))
}

/**
 * 按指针影响位移一个网格顶点：向外按透视比例放大，再按影响抬升。
 * @param x - 顶点原始横坐标。
 * @param y - 顶点原始纵坐标。
 * @param pointerX - 指针横坐标；缺省时不做位移。
 * @param pointerY - 指针纵坐标；缺省时不做位移。
 * @param spec - 高斯与透视参数。
 * @param strength - 全局影响强度 0–1，用于回弹动画。
 * @returns 位移后的顶点与亮度系数；强度为 0 时原样返回。
 */
export function warpVertex(
  x: number,
  y: number,
  pointerX: number | null,
  pointerY: number | null,
  spec: GridWarpSpec,
  strength = 1,
): GridVertex {
  const weight = clamp01(strength)
  if (weight === 0 || pointerX === null || pointerY === null) return { x, y, glow: 0 }
  const dx = x - pointerX
  const dy = y - pointerY
  const glow = gridInfluence(dx, dy, spec.sigma) * weight
  if (glow === 0) return { x, y, glow: 0 }
  const zoom = 1 + glow * spec.perspective
  return {
    x: pointerX + dx * zoom,
    y: pointerY + dy * zoom - spec.lift * glow,
    glow,
  }
}

/**
 * 线条透明度：静止时取底色，越靠近指针越接近峰值。
 * @param base - 静止时的透明度。
 * @param peak - 指针处的峰值透明度。
 * @param glow - 0–1 的高斯影响。
 * @returns 混合后的透明度。
 */
export function lineAlpha(base: number, peak: number, glow: number): number {
  const weight = clamp01(glow)
  return base + (peak - base) * weight
}

/**
 * 从 0 开始、按 spacing 排布的网格线位置，覆盖 0–extent 并各留一条在外侧。
 * @param extent - 画布在排布方向上的长度（CSS 像素）。
 * @param spacing - 相邻线的间距。
 * @param offset - 首条线的相位偏移，通常取 0。
 * @returns 升序位置数组；参数不合法时为空。
 */
export function gridOffsets(extent: number, spacing: number, offset = 0): number[] {
  if (!(extent > 0) || !(spacing > 0)) return []
  const start = ((offset % spacing) + spacing) % spacing
  const positions: number[] = []
  for (let position = start - spacing; position <= extent + spacing; position += spacing) {
    positions.push(position)
  }
  return positions
}

/**
 * 读取皮肤声明的底纹类型。
 * @param value - `--lc-backdrop-motif` 的计算值。
 * @returns 已知类型；空值、未知值与大小写不一致都回 `grid`。
 */
export function readMotif(value: string): BackdropMotif {
  return value.trim() === 'plum' ? 'plum' : 'grid'
}

/**
 * 节点行列的确定性伪随机值。
 * @param column - 节点列号。
 * @param row - 节点行号。
 * @param salt - 同一节点上不同用途的独立噪声。
 * @returns 0–1 之间的值。
 */
function nodeNoise(column: number, row: number, salt: number): number {
  const seed = Math.sin(column * 127.1 + row * 311.7 + salt * 74.7) * 43758.5453
  return seed - Math.floor(seed)
}

/** 一朵梅花的姿态；偏移以节点间距为单位，半径缩放无量纲。 */
export interface BlossomPose {
  /** 相对节点的横向偏移，单位为间距。 */
  readonly dx: number
  /** 相对节点的纵向偏移，单位为间距。 */
  readonly dy: number
  /** 整朵花的旋转角，弧度。 */
  readonly angle: number
  /** 半径缩放，0.7–1。 */
  readonly scale: number
}

/**
 * 按节点行列取一个确定性的梅花姿态：同一格静止与动画帧一致，相邻格错开。
 * @param column - 节点列号。
 * @param row - 节点行号。
 * @returns 该格梅花的偏移、旋转与缩放。
 */
export function blossomPose(column: number, row: number): BlossomPose {
  return {
    dx: (nodeNoise(column, row, 1) - 0.5) * 0.5,
    dy: (nodeNoise(column, row, 2) - 0.5) * 0.5,
    angle: nodeNoise(column, row, 3) * Math.PI * 2,
    scale: 0.7 + nodeNoise(column, row, 4) * 0.3,
  }
}

/** 节点长出梅花的概率；其余节点留空，避免整片连成网。 */
export const BLOSSOM_DENSITY = 0.34

/**
 * 该节点是否长出一朵梅花。
 * @param column - 节点列号。
 * @param row - 节点行号。
 * @returns 为真时画一朵花；同一节点恒定。
 */
export function blossomVisible(column: number, row: number): boolean {
  return nodeNoise(column, row, 5) < BLOSSOM_DENSITY
}

/** 梅花的花瓣数。 */
export const PLUM_PETALS = 5

/** 一片花瓣的椭圆参数；中心相对花朵中心，长轴沿径向。 */
export interface PetalEllipse {
  /** 花瓣中心的横坐标。 */
  readonly x: number
  /** 花瓣中心的纵坐标。 */
  readonly y: number
  /** 半短轴，沿切向。 */
  readonly rx: number
  /** 半长轴，沿径向。 */
  readonly ry: number
  /** 长轴的旋转角，弧度。 */
  readonly rotation: number
}

/** 花瓣半短轴相对花朵半径；花瓣之间留出可见缝隙。 */
export const PETAL_WIDTH_RATIO = 0.42

/** 花瓣半长轴相对花朵半径；内端停在中心点外，给花心留位置。 */
export const PETAL_LENGTH_RATIO = 0.78

/** 花心圆半径相对花朵半径。 */
export const PETAL_CORE_RATIO = 0.26

/**
 * 五瓣梅花的几何：花瓣等角分布在半径之外，长轴沿径向。
 * @param radius - 花朵中心到花瓣中心的距离。
 * @param angle - 整朵花的旋转角，弧度。
 * @returns 五片花瓣的椭圆参数，相对花朵中心。
 */
export function plumPetals(radius: number, angle: number): PetalEllipse[] {
  const petals: PetalEllipse[] = []
  for (let index = 0; index < PLUM_PETALS; index++) {
    const theta = angle + (index * Math.PI * 2) / PLUM_PETALS
    petals.push({
      x: Math.cos(theta) * radius,
      y: Math.sin(theta) * radius,
      rx: radius * PETAL_WIDTH_RATIO,
      ry: radius * PETAL_LENGTH_RATIO,
      rotation: theta - Math.PI / 2,
    })
  }
  return petals
}

/** 3、4、6、8 位十六进制颜色。 */
const HEX_PATTERN = /^#([0-9a-f]{3,8})$/i

/** rgb()/rgba() 的逗号与空格两种写法。 */
const RGB_PATTERN = /^rgba?\(\s*([^)]+)\)$/i

/**
 * 解析 CSS 颜色：十六进制、rgb()/rgba()（逗号或空格分隔）以及 transparent。
 * @param value - `getPropertyValue` 读到的原始文本。
 * @returns 解析结果；无法识别时为 null。
 */
export function parseCssColor(value: string): GridColor | null {
  const text = value.trim()
  if (text === '') return null
  if (text === 'transparent') return { r: 0, g: 0, b: 0, alpha: 0 }
  const hex = HEX_PATTERN.exec(text)
  if (hex !== null) {
    const digits = hex[1] ?? ''
    const expand = (index: number): number => parseInt(digits.charAt(index), 16)
    if (digits.length === 3 || digits.length === 4) {
      const alpha = digits.length === 4 ? expand(3) / 15 : 1
      return { r: expand(0) * 17, g: expand(1) * 17, b: expand(2) * 17, alpha }
    }
    if (digits.length === 6 || digits.length === 8) {
      const byte = (index: number): number => parseInt(digits.slice(index, index + 2), 16)
      const alpha = digits.length === 8 ? byte(6) / 255 : 1
      return { r: byte(0), g: byte(2), b: byte(4), alpha }
    }
    return null
  }
  const rgb = RGB_PATTERN.exec(text)
  if (rgb === null) return null
  const parts = (rgb[1] ?? '').split(/[\s,/]+/).filter(part => part !== '')
  const [rPart, gPart, bPart, aPart] = parts
  if (rPart === undefined || gPart === undefined || bPart === undefined) return null
  const channel = (part: string): number | null => {
    const match = /^([0-9]+(?:\.[0-9]+)?)(%?)$/.exec(part)
    if (match === null) return null
    const number = Number(match[1] ?? '')
    return match[2] === '%' ? (number / 100) * 255 : number
  }
  const r = channel(rPart)
  const g = channel(gPart)
  const b = channel(bPart)
  if (r === null || g === null || b === null) return null
  let alpha = 1
  if (aPart !== undefined) {
    const value4 = /^([0-9]+(?:\.[0-9]+)?)(%?)$/.exec(aPart)
    if (value4 === null) return null
    const number = Number(value4[1] ?? '')
    alpha = value4[2] === '%' ? number / 100 : number
  }
  return { r, g, b, alpha: clamp01(alpha) }
}

/**
 * 按给定透明度输出 canvas 可用的 rgba() 字符串。
 * @param color - 已解析颜色；其 alpha 会被替换。
 * @param alpha - 目标透明度 0–1。
 * @returns `rgba(r, g, b, a)` 文本。
 */
export function rgba(color: GridColor, alpha: number): string {
  const round = (value: number): number => Math.round(Math.min(255, Math.max(0, value)))
  return `rgba(${round(color.r)}, ${round(color.g)}, ${round(color.b)}, ${clamp01(alpha)})`
}
