/** 设置页占位：模型、路由、皮肤与账号在 M3 接入。 */

import type { JSX } from 'react'

/**
 * 设置页。
 * @returns 占位页。
 */
export function SettingsPage(): JSX.Element {
  return (
    <section className="page" data-testid="page-settings">
      <header className="page-head">
        <div>
          <h2>设置</h2>
          <p className="page-sub">M2 只保留入口；模型、路由、皮肤、字体与账号在 M3 实现。</p>
        </div>
      </header>
      <div className="placeholder lg-glass-card">
        <h3>尚未接入</h3>
        <p>当前客户端仍使用液态玻璃浅色主题与宿主默认模型。设置页会在 M3 读取 `settings.describe`、`credentials.describe` 与 `llm.*`，并提供四套皮肤与中英切换。</p>
      </div>
    </section>
  )
}
