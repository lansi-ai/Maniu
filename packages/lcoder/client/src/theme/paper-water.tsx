/**
 * 登录页水流底：Paper Water 着色器（@paper-design/shaders-react 0.0.82，Apache-2.0；
 * Copyright Paper Design，见该包 LICENSE）加一层浅雾彩正片叠底。
 *
 * 水面按皮肤取色：浅色皮肤用雾彩，暗色皮肤换成深水与滤色雾彩；未知皮肤回落雾彩。
 * 没有 WebGL 时退回同色系静态渐变，减少动态效果时水面渲染一帧后静止。
 */

import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { Water } from '@paper-design/shaders-react'

/** 水面与雾彩的一套取色。 */
export interface WaterTone {
  /** 静态回退的兜底底色。 */
  readonly base: string
  /** 静态回退的四团柔光，直接用进 background。 */
  readonly underlay: string
  /** 水面底色。 */
  readonly waterBack: string
  /** 水面高光色，`highlights` 为 0 时不可见。 */
  readonly waterHighlight: string
  /** 叠在水面上的雾彩，末尾要拼 `, transparent`。 */
  readonly wash: string
  /** 雾彩与水面的混合方式：浅底用正片叠底，暗底用滤色。 */
  readonly blend: 'multiply' | 'screen'
  /** 雾彩整体不透明度。 */
  readonly washOpacity: number
  /**
   * 水面细节强度。浅色底用原型参数；暗色底把高光与焦散压低，否则亮纹会压过卡片。
   */
  readonly detail: {
    readonly highlights: number
    readonly caustic: number
    readonly waves: number
    readonly edges: number
  }
}

/** 浅色底的水面细节，与 T-204 原型默认一致。 */
const LIGHT_DETAIL = { highlights: 0.58, caustic: 0.43, waves: 0.36, edges: 0.35 } as const
/** 暗色底的水面细节：只留一层缓慢的暗涌。 */
const DARK_DETAIL = { highlights: 0.16, caustic: 0.1, waves: 0.2, edges: 0.2 } as const

/** 浅雾彩色调标识。 */
export type WaterToneId = 'mist' | 'peach' | 'lilac' | 'nocturne' | 'glacier'

/**
 * 五套色调。雾彩、桃青与薰衣草是 T-204 原型定过的浅雾彩；夜航与冰川给暗色皮肤，
 * 产品不暴露切换开关，只按皮肤取用。
 */
export const WATER_TONES: Readonly<Record<WaterToneId, WaterTone>> = {
  mist: {
    base: '#f6fafd',
    underlay:
      'radial-gradient(58% 66% at 21% 26%, #e1f6ec 0%, rgba(225,246,236,0) 62%),' +
      'radial-gradient(52% 58% at 79% 30%, #fbe5ee 0%, rgba(251,229,238,0) 62%),' +
      'radial-gradient(56% 60% at 64% 80%, #e6e1fb 0%, rgba(230,225,251,0) 64%),' +
      'radial-gradient(48% 52% at 30% 78%, #e0f0fc 0%, rgba(224,240,252,0) 62%)',
    waterBack: '#eff8f4',
    waterHighlight: '#d9ebfb',
    wash:
      'radial-gradient(62% 72% at 20% 25%, rgba(190,232,212,.85) 0%, rgba(190,232,212,0) 62%),' +
      'radial-gradient(55% 62% at 80% 30%, rgba(246,199,220,.8) 0%, rgba(246,199,220,0) 62%),' +
      'radial-gradient(58% 64% at 62% 82%, rgba(211,198,243,.8) 0%, rgba(211,198,243,0) 64%),' +
      'radial-gradient(50% 56% at 26% 76%, rgba(195,223,247,.85) 0%, rgba(195,223,247,0) 62%)',
    blend: 'multiply',
    washOpacity: 0.82,
    detail: LIGHT_DETAIL,
  },
  peach: {
    base: '#fdf9f6',
    underlay:
      'radial-gradient(58% 66% at 22% 24%, #fde8dc 0%, rgba(253,232,220,0) 62%),' +
      'radial-gradient(52% 58% at 78% 32%, #fae3ec 0%, rgba(250,227,236,0) 62%),' +
      'radial-gradient(54% 58% at 62% 80%, #e6f4ea 0%, rgba(230,244,234,0) 64%),' +
      'radial-gradient(46% 50% at 28% 76%, #fdf2dd 0%, rgba(253,242,221,0) 62%)',
    waterBack: '#fdf4ec',
    waterHighlight: '#ffe4d2',
    wash:
      'radial-gradient(62% 72% at 20% 25%, rgba(250,214,186,.8) 0%, rgba(250,214,186,0) 62%),' +
      'radial-gradient(55% 62% at 80% 30%, rgba(247,198,216,.8) 0%, rgba(247,198,216,0) 62%),' +
      'radial-gradient(58% 64% at 62% 82%, rgba(198,231,209,.8) 0%, rgba(198,231,209,0) 64%),' +
      'radial-gradient(50% 56% at 26% 76%, rgba(252,232,190,.85) 0%, rgba(252,232,190,0) 62%)',
    blend: 'multiply',
    washOpacity: 0.82,
    detail: LIGHT_DETAIL,
  },
  lilac: {
    base: '#f8f7fd',
    underlay:
      'radial-gradient(58% 66% at 22% 26%, #ebe5fb 0%, rgba(235,229,251,0) 62%),' +
      'radial-gradient(52% 58% at 78% 30%, #dfe9fb 0%, rgba(223,233,251,0) 62%),' +
      'radial-gradient(54% 58% at 64% 80%, #f7e3f0 0%, rgba(247,227,240,0) 64%),' +
      'radial-gradient(46% 50% at 28% 78%, #e2f4f1 0%, rgba(226,244,241,0) 62%)',
    waterBack: '#f4f2fc',
    waterHighlight: '#e0daf9',
    wash:
      'radial-gradient(62% 72% at 20% 25%, rgba(206,196,244,.8) 0%, rgba(206,196,244,0) 62%),' +
      'radial-gradient(55% 62% at 80% 30%, rgba(198,214,247,.82) 0%, rgba(198,214,247,0) 62%),' +
      'radial-gradient(58% 64% at 62% 82%, rgba(245,203,229,.75) 0%, rgba(245,203,229,0) 64%),' +
      'radial-gradient(50% 56% at 26% 76%, rgba(199,235,229,.75) 0%, rgba(199,235,229,0) 62%)',
    blend: 'multiply',
    washOpacity: 0.82,
    detail: LIGHT_DETAIL,
  },
  nocturne: {
    base: '#070b14',
    underlay:
      'radial-gradient(58% 66% at 21% 26%, rgba(34,211,238,0.22) 0%, rgba(34,211,238,0) 62%),' +
      'radial-gradient(52% 58% at 79% 30%, rgba(244,114,182,0.18) 0%, rgba(244,114,182,0) 62%),' +
      'radial-gradient(56% 60% at 64% 80%, rgba(129,140,248,0.16) 0%, rgba(129,140,248,0) 64%),' +
      'radial-gradient(48% 52% at 30% 78%, rgba(45,212,191,0.14) 0%, rgba(45,212,191,0) 62%)',
    waterBack: '#081421',
    waterHighlight: '#12455c',
    wash:
      'radial-gradient(62% 72% at 20% 25%, rgba(34,211,238,.34) 0%, rgba(34,211,238,0) 62%),' +
      'radial-gradient(55% 62% at 80% 30%, rgba(244,114,182,.26) 0%, rgba(244,114,182,0) 62%),' +
      'radial-gradient(58% 64% at 62% 82%, rgba(129,140,248,.28) 0%, rgba(129,140,248,0) 64%),' +
      'radial-gradient(50% 56% at 26% 76%, rgba(45,212,191,.24) 0%, rgba(45,212,191,0) 62%)',
    blend: 'screen',
    washOpacity: 0.5,
    detail: DARK_DETAIL,
  },
  glacier: {
    base: '#12161f',
    underlay:
      'radial-gradient(58% 66% at 22% 26%, rgba(125,211,252,0.18) 0%, rgba(125,211,252,0) 62%),' +
      'radial-gradient(52% 58% at 78% 30%, rgba(163,230,53,0.1) 0%, rgba(163,230,53,0) 62%),' +
      'radial-gradient(54% 58% at 64% 80%, rgba(148,163,184,0.16) 0%, rgba(148,163,184,0) 64%),' +
      'radial-gradient(46% 50% at 28% 78%, rgba(125,211,252,0.12) 0%, rgba(125,211,252,0) 62%)',
    waterBack: '#101722',
    waterHighlight: '#2a4258',
    wash:
      'radial-gradient(62% 72% at 20% 25%, rgba(125,211,252,.26) 0%, rgba(125,211,252,0) 62%),' +
      'radial-gradient(55% 62% at 80% 30%, rgba(163,230,53,.14) 0%, rgba(163,230,53,0) 62%),' +
      'radial-gradient(58% 64% at 62% 82%, rgba(148,163,184,.24) 0%, rgba(148,163,184,0) 64%),' +
      'radial-gradient(50% 56% at 26% 76%, rgba(125,211,252,.2) 0%, rgba(125,211,252,0) 62%)',
    blend: 'screen',
    washOpacity: 0.44,
    detail: DARK_DETAIL,
  },
}

/** 皮肤到色调：浅色皮肤用雾彩或桃青，暗色皮肤用夜航或冰川，未知皮肤回落雾彩。 */
const SKIN_TONES: Readonly<Record<string, WaterToneId>> = {
  'liquid-glass': 'mist',
  rose: 'peach',
  neon: 'nocturne',
  silver: 'glacier',
}

/**
 * 按皮肤标识取色调。
 * @param skin - 根元素的 `data-skin`；未知或缺失时按雾彩处理。
 * @returns 该皮肤的水色与雾彩。
 */
export function waterToneFor(skin: string): WaterTone {
  return WATER_TONES[SKIN_TONES[skin] ?? 'mist']
}

/** 根元素的皮肤标识；设置页切换皮肤时同步更新。 */
function useSkin(): string {
  const [skin, setSkin] = useState(() => document.documentElement.dataset.skin ?? 'liquid-glass')
  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => { setSkin(root.dataset.skin ?? 'liquid-glass') })
    observer.observe(root, { attributes: true, attributeFilter: ['data-skin'] })
    return () => { observer.disconnect() }
  }, [])
  return skin
}

/** 系统「减弱动态效果」是否开启。 */
function useReducedMotion(): boolean {
  const query = useMemo(
    () => typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null,
    [],
  )
  const [reduced, setReduced] = useState(() => query?.matches ?? false)
  useEffect(() => {
    if (query === null) return
    const onChange = (): void => { setReduced(query.matches) }
    query.addEventListener('change', onChange)
    return () => { query.removeEventListener('change', onChange) }
  }, [query])
  return reduced
}

/** 探测一次 WebGL 并释放探测上下文，避免占住一个 WebGL 槽位。 */
let webglSupport: boolean | null = null
function hasWebgl(): boolean {
  if (webglSupport !== null) return webglSupport
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
  webglSupport = context !== null
  context?.getExtension('WEBGL_lose_context')?.loseContext()
  return webglSupport
}

/** 水流底属性。 */
export interface PaperWaterProps {
  /** 背景容器的 testid；默认沿用登录页的 `login-water`。 */
  readonly testId?: string
}

/**
 * 登录页水流背景。
 * @param props - 背景容器的 testid。
 * @returns 铺满主区、不接指针事件的水面与雾彩层；无 WebGL 时是静态渐变。
 */
export function PaperWater({ testId = 'login-water' }: PaperWaterProps): JSX.Element {
  const tone = waterToneFor(useSkin())
  const reduced = useReducedMotion()
  const webgl = useMemo(hasWebgl, [])
  if (!webgl) {
    return (
      <div className="login-backdrop" data-testid={testId} data-engine="static" aria-hidden="true">
        <div className="login-tone-static" style={{ background: `${tone.underlay}, ${tone.base}` }} />
      </div>
    )
  }
  return (
    <div className="login-backdrop" data-testid={testId} data-engine="water" aria-hidden="true">
      <Water
        className="login-water"
        colorBack={tone.waterBack}
        colorHighlight={tone.waterHighlight}
        highlights={tone.detail.highlights}
        layering={0.45}
        edges={tone.detail.edges}
        caustic={tone.detail.caustic}
        waves={tone.detail.waves}
        size={1.7}
        speed={reduced ? 0 : 0.45}
        minPixelRatio={1}
        maxPixelCount={1_400_000}
        width="100%"
        height="100%"
      />
      <div
        className="login-tone-wash"
        data-blend={tone.blend}
        style={{ background: `${tone.wash}, transparent`, opacity: String(tone.washOpacity) }}
      />
    </div>
  )
}
