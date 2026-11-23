/** 渲染端入口。 */

import { createRoot } from 'react-dom/client'
import { App } from './app.tsx'
import { PrototypeStudioApp } from './prototype-studio/studio-app.tsx'
import { applyPreferences, hydratePreferences } from './prefs.ts'
import './index.css'
import './styles.css'
import './pages/workbench.css'
import './pages/account.css'
import './pages/settings.css'
import './prototype-studio/studio.css'

const container = document.getElementById('root')
if (container === null) throw new Error('缺少 #root')

// 主进程是皮肤/字体/语言的权威值：先取回落盘值再挂载，避免闪一帧默认皮肤。
void hydratePreferences().then((preferences) => {
  applyPreferences(preferences)
  const params = new URLSearchParams(window.location.search)
  if (params.get('view') === 'prototype-studio') {
    const requirementId = params.get('requirementId') ?? ''
    const sessionId = params.get('sessionId') ?? undefined
    createRoot(container).render(<PrototypeStudioApp requirementId={requirementId} initialSessionId={sessionId} />)
    return
  }
  createRoot(container).render(<App />)
})
