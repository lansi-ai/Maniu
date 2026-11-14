/** 渲染端入口。 */

import { createRoot } from 'react-dom/client'
import { App } from './app.tsx'
import { applyPreferences, browserStorage, readPreferences } from './prefs.ts'
import './theme/liquid-glass.css'
import './theme/skins.css'
import './styles.css'
import './pages/workbench.css'
import './pages/account.css'
import './pages/settings.css'

// 先落偏好再挂载：避免刷新时闪一帧默认皮肤。
applyPreferences(readPreferences(browserStorage()))

const container = document.getElementById('root')
if (container === null) throw new Error('缺少 #root')
createRoot(container).render(<App />)
