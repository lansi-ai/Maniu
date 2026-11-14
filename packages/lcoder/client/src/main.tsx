/** 渲染端入口。 */

import { createRoot } from 'react-dom/client'
import { App } from './app.tsx'
import './styles.css'

const container = document.getElementById('root')
if (container === null) throw new Error('缺少 #root')
createRoot(container).render(<App />)
