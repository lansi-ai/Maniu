/** 渲染端入口。 */

import { createRoot } from 'react-dom/client'
import { App } from './app.tsx'
import { applyPreferences, hydratePreferences } from './prefs.ts'
import './index.css'
import './styles.css'
import './pages/workbench.css'
import './pages/account.css'
import './pages/settings.css'

const container = document.getElementById('root')
if (container === null) throw new Error('缺少 #root')

// 主进程是皮肤/字体/语言的权威值：先取回落盘值再挂载，避免闪一帧默认皮肤。
void hydratePreferences().then((preferences) => {
  applyPreferences(preferences)
  createRoot(container).render(<App />)
})
