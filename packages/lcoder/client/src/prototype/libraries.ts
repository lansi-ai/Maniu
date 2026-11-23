/** 原型组件素材库模型、内置 4 套风格库、本地持久化与订阅钩子。 */

import { useEffect, useState } from 'react'
import { translate, type MessageKey, type Translate } from '../locale.ts'
import { browserStorage } from '../prefs.ts'

/** 组件素材库数据模型。 */
export interface PrototypeLibrary {
  readonly id: string
  readonly name: string
  readonly summary: string
  readonly tags: readonly string[]
  readonly builtin: boolean
  readonly palette: readonly string[]
  readonly designTokens: string
  readonly componentGuidelines: string
  readonly previewHtml: string
  readonly updatedAt?: string | undefined
}

/** 新建或编辑自定义素材库时的输入载荷。 */
export interface PrototypeLibraryDraft {
  readonly name: string
  readonly summary: string
  readonly tags: readonly string[]
  readonly palette: readonly string[]
  readonly designTokens: string
  readonly componentGuidelines: string
  readonly previewHtml: string
}

/** 读取后的素材库完整状态：内置在前、自定义在后，外加当前默认库标识。 */
export interface PrototypeLibraryState {
  readonly libraries: readonly PrototypeLibrary[]
  readonly customLibraries: readonly PrototypeLibrary[]
  readonly defaultLibraryId: string
}

/** 最小本地存储接口；便于在测试中注入隔离存储。 */
export interface LibraryStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** 默认内置素材库标识。 */
export const DEFAULT_PROTOTYPE_LIBRARY_ID = 'heroui-glass'

/** 自定义素材库 localStorage 存储键。 */
export const PROTOTYPE_LIBRARIES_STORAGE_KEY = 'lcoder.prototype.libraries.v1'

/** 默认素材库偏好 localStorage 存储键。 */
export const PROTOTYPE_DEFAULT_LIBRARY_STORAGE_KEY = 'lcoder.prototype.default-library.v1'

/** 同页内多个组件之间广播素材库变更的事件名。 */
const LIBRARY_CHANGE_EVENT = 'lcoder:prototype-libraries-changed'

const DEFAULT_FALLBACK_PALETTE: readonly string[] = ['#6366F1', '#0F172A', '#F8FAFC']

interface BuiltinCopyKeys {
  readonly nameKey: MessageKey
  readonly summaryKey: MessageKey
  readonly tagKeys: readonly [MessageKey, MessageKey, MessageKey]
}

const BUILTIN_COPY_KEYS: Readonly<Record<string, BuiltinCopyKeys>> = {
  'heroui-glass': {
    nameKey: 'protoLib.builtin.heroui-glass.name',
    summaryKey: 'protoLib.builtin.heroui-glass.summary',
    tagKeys: [
      'protoLib.builtin.heroui-glass.tag1',
      'protoLib.builtin.heroui-glass.tag2',
      'protoLib.builtin.heroui-glass.tag3',
    ],
  },
  'enterprise-admin': {
    nameKey: 'protoLib.builtin.enterprise-admin.name',
    summaryKey: 'protoLib.builtin.enterprise-admin.summary',
    tagKeys: [
      'protoLib.builtin.enterprise-admin.tag1',
      'protoLib.builtin.enterprise-admin.tag2',
      'protoLib.builtin.enterprise-admin.tag3',
    ],
  },
  'minimal-linear': {
    nameKey: 'protoLib.builtin.minimal-linear.name',
    summaryKey: 'protoLib.builtin.minimal-linear.summary',
    tagKeys: [
      'protoLib.builtin.minimal-linear.tag1',
      'protoLib.builtin.minimal-linear.tag2',
      'protoLib.builtin.minimal-linear.tag3',
    ],
  },
  'mobile-card': {
    nameKey: 'protoLib.builtin.mobile-card.name',
    summaryKey: 'protoLib.builtin.mobile-card.summary',
    tagKeys: [
      'protoLib.builtin.mobile-card.tag1',
      'protoLib.builtin.mobile-card.tag2',
      'protoLib.builtin.mobile-card.tag3',
    ],
  },
}

const HEROUI_GLASS_PREVIEW = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>HeroUI Glass 样板</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    padding: 20px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
    color: #f8fafc;
    background:
      radial-gradient(640px 280px at 12% 0%, rgba(249, 115, 22, 0.24), transparent 70%),
      radial-gradient(560px 320px at 90% 10%, rgba(99, 102, 241, 0.28), transparent 72%),
      #0b1120;
  }
  .shell { max-width: 960px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
  .glass {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 18px;
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.14) inset, 0 18px 40px -18px rgba(2, 6, 23, 0.72);
    backdrop-filter: blur(18px);
  }
  .nav { display: flex; align-items: center; justify-content: space-between; padding: 12px 18px; }
  .brand { font-weight: 700; font-size: 14px; letter-spacing: -0.01em; display: flex; align-items: center; gap: 8px; }
  .brand-dot { width: 10px; height: 10px; border-radius: 999px; background: linear-gradient(135deg, #fb923c, #6366f1); }
  .nav-links { display: flex; gap: 14px; font-size: 12px; color: #cbd5e1; }
  .nav-links span.active { color: #ffffff; font-weight: 600; }
  .hero { padding: 20px 22px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px; }
  .hero h1 { margin: 0 0 6px; font-size: 20px; letter-spacing: -0.02em; }
  .hero p { margin: 0; font-size: 13px; color: #cbd5e1; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .btn {
    border: 0; border-radius: 999px; padding: 8px 16px; font-size: 12px; font-weight: 600; cursor: pointer;
  }
  .btn-primary { background: linear-gradient(135deg, #6366f1, #818cf8); color: #ffffff; box-shadow: 0 8px 20px -8px rgba(99, 102, 241, 0.8); }
  .btn-secondary { background: rgba(255, 255, 255, 0.12); color: #f8fafc; border: 1px solid rgba(255, 255, 255, 0.18); }
  .btn-ghost { background: transparent; color: #cbd5e1; border: 1px solid rgba(255, 255, 255, 0.14); }
  .grid { display: grid; grid-template-columns: 1fr 1.2fr; gap: 14px; }
  .card { padding: 16px 18px; }
  .card h2 { margin: 0 0 10px; font-size: 14px; color: #f8fafc; }
  .form { display: flex; flex-direction: column; gap: 10px; }
  .field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #cbd5e1; }
  .input {
    height: 34px; padding: 0 12px; border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.18); background: rgba(15, 23, 42, 0.45); color: #f8fafc; font-size: 12px;
  }
  .kpis { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .kpi { padding: 12px; border-radius: 14px; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.12); }
  .kpi-label { font-size: 11px; color: #94a3b8; }
  .kpi-val { margin-top: 4px; font-size: 18px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; color: #94a3b8; font-weight: 600; padding: 8px 10px; border-bottom: 1px solid rgba(255, 255, 255, 0.12); }
  td { padding: 9px 10px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); color: #e2e8f0; }
  .badge { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 600; }
  .badge-ok { background: rgba(16, 185, 129, 0.2); color: #6ee7b7; border: 1px solid rgba(16, 185, 129, 0.35); }
  .badge-warn { background: rgba(249, 115, 22, 0.2); color: #fdba74; border: 1px solid rgba(249, 115, 22, 0.35); }
  .badge-info { background: rgba(99, 102, 241, 0.22); color: #c7d2fe; border: 1px solid rgba(99, 102, 241, 0.38); }
  .footer { padding: 10px 16px; display: flex; justify-content: space-between; font-size: 11px; color: #94a3b8; }
</style>
</head>
<body>
  <div class="shell">
    <nav class="glass nav">
      <div class="brand"><span class="brand-dot"></span>HeroUI Glass 控制台</div>
      <div class="nav-links"><span class="active">概览</span><span>工作流</span><span>发布</span></div>
    </nav>
    <section class="glass hero">
      <div>
        <h1>智能化研发工作台</h1>
        <p>半透明毛玻璃层次、胶囊操作与 Bento 卡片布局。</p>
      </div>
      <div class="actions">
        <button class="btn btn-primary" type="button">新建任务</button>
        <button class="btn btn-secondary" type="button">导出报告</button>
        <button class="btn btn-ghost" type="button">查看日志</button>
      </div>
    </section>
    <div class="grid">
      <section class="glass card">
        <h2>快速筛选与创建</h2>
        <form class="form">
          <label class="field">任务名称<input class="input" value="订单中心权限重构" readonly></label>
          <label class="field">负责人<input class="input" value="架构组 · 林默" readonly></label>
          <div class="kpis">
            <div class="kpi"><div class="kpi-label">通过率</div><div class="kpi-val">98.4%</div></div>
            <div class="kpi"><div class="kpi-label">活跃流</div><div class="kpi-val">14</div></div>
          </div>
        </form>
      </section>
      <section class="glass card">
        <h2>交付状态清单</h2>
        <table>
          <thead><tr><th>模块</th><th>阶段</th><th>状态</th></tr></thead>
          <tbody>
            <tr><td>身份认证</td><td>灰度验证</td><td><span class="badge badge-ok">已就绪</span></td></tr>
            <tr><td>账单导出</td><td>契约复核</td><td><span class="badge badge-warn">待确认</span></td></tr>
            <tr><td>消息推送</td><td>原型设计</td><td><span class="badge badge-info">进行中</span></td></tr>
          </tbody>
        </table>
      </section>
    </div>
    <footer class="glass footer"><span>Glass Design System · v3</span><span>零脚本沙箱样板</span></footer>
  </div>
</body>
</html>`

const ENTERPRISE_ADMIN_PREVIEW = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>企业级中后台样板</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    background: #f3f6fb;
    color: #1e293b;
    font-family: "Segoe UI", "PingFang SC", -apple-system, sans-serif;
    font-size: 13px;
  }
  .topbar {
    height: 44px; padding: 0 18px; background: #0f172a; color: #f8fafc;
    display: flex; align-items: center; justify-content: space-between;
  }
  .topbar-nav { display: flex; align-items: center; gap: 18px; font-size: 12px; }
  .topbar-nav strong { font-size: 13px; color: #ffffff; }
  .topbar-nav span { color: #94a3b8; }
  .topbar-nav span.active { color: #ffffff; border-bottom: 2px solid #3b82f6; padding: 12px 0; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
  .panel { background: #ffffff; border: 1px solid #dbe3ef; border-radius: 6px; padding: 12px 14px; }
  .hero { display: flex; align-items: center; justify-content: space-between; gap: 12px; border-left: 3px solid #1d4ed8; }
  .hero h1 { margin: 0 0 2px; font-size: 16px; color: #0f172a; }
  .hero p { margin: 0; font-size: 12px; color: #64748b; }
  .btn-row { display: flex; gap: 6px; }
  .btn { height: 30px; padding: 0 12px; border-radius: 4px; font-size: 12px; font-weight: 500; cursor: pointer; border: 1px solid transparent; }
  .btn-primary { background: #1d4ed8; color: #ffffff; }
  .btn-default { background: #ffffff; color: #334155; border-color: #cbd5e1; }
  .btn-link { background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe; }
  .filters { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; align-items: end; }
  .field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #475569; }
  .input {
    height: 30px; padding: 0 8px; border: 1px solid #cbd5e1; border-radius: 4px; background: #ffffff; color: #0f172a; font-size: 12px;
  }
  .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .metric { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 8px 10px; }
  .metric small { color: #64748b; font-size: 11px; }
  .metric strong { display: block; margin-top: 2px; font-size: 16px; color: #0f172a; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #f8fafc; color: #475569; text-align: left; font-weight: 600; padding: 7px 10px; border-bottom: 1px solid #dbe3ef; }
  td { padding: 7px 10px; border-bottom: 1px solid #eef2f6; font-variant-numeric: tabular-nums; }
  .tag { display: inline-block; padding: 1px 7px; border-radius: 3px; font-size: 11px; font-weight: 500; }
  .tag-ok { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
  .tag-warn { background: #fffbeb; color: #b45309; border: 1px solid #fde68a; }
  .tag-muted { background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; }
  .footer { display: flex; justify-content: space-between; font-size: 11px; color: #64748b; padding: 2px 2px; }
</style>
</head>
<body>
  <header class="topbar">
    <nav class="topbar-nav">
      <strong>ERP 运营管理平台</strong>
      <span class="active">采购审批</span>
      <span>供应商台账</span>
      <span>结算对账</span>
    </nav>
    <span style="font-size:12px;color:#cbd5e1;">华东大区 · 管理员</span>
  </header>
  <main class="wrap">
    <section class="panel hero">
      <div>
        <h1>季度采购单集中审批台</h1>
        <p>高密度表格式中后台规范：4px 小圆角、1px 细边框、紧凑表单筛选与等宽数字列。</p>
      </div>
      <div class="btn-row">
        <button class="btn btn-primary" type="button">批量通过</button>
        <button class="btn btn-link" type="button">导出明细</button>
        <button class="btn btn-default" type="button">重置</button>
      </div>
    </section>
    <section class="panel">
      <div class="filters">
        <label class="field">单据编号<input class="input" value="PO-202611-048" readonly></label>
        <label class="field">部门<input class="input" value="基础设施采购部" readonly></label>
        <label class="field">金额下限<input class="input" value="¥ 50,000.00" readonly></label>
        <button class="btn btn-primary" type="button">查询单据</button>
      </div>
    </section>
    <section class="metrics">
      <div class="metric"><small>今日待审</small><strong>28 笔</strong></div>
      <div class="metric"><small>核准总额</small><strong>¥ 1,482,900</strong></div>
      <div class="metric"><small>SLA 达成率</small><strong>99.1%</strong></div>
    </section>
    <section class="panel">
      <table>
        <thead><tr><th>单据号</th><th>供应商</th><th>金额</th><th>状态</th></tr></thead>
        <tbody>
          <tr><td>PO-202611-048</td><td>云杉计算科技有限公司</td><td>¥ 320,000.00</td><td><span class="tag tag-ok">已核准</span></td></tr>
          <tr><td>PO-202611-049</td><td>华信网络设备股份</td><td>¥ 145,500.00</td><td><span class="tag tag-warn">复核中</span></td></tr>
          <tr><td>PO-202611-050</td><td>北辰办公集采中心</td><td>¥ 28,400.00</td><td><span class="tag tag-muted">已归档</span></td></tr>
        </tbody>
      </table>
    </section>
    <footer class="footer"><span>Enterprise Admin Tokens</span><span>共 3 条记录 · 第 1 页</span></footer>
  </main>
</body>
</html>`

const MINIMAL_LINEAR_PREVIEW = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>极简现代 SaaS 样板</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    background: #fafaf9;
    color: #18181b;
    font-family: "Inter", -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
  }
  .page { max-width: 880px; margin: 0 auto; padding: 20px 24px 28px; display: flex; flex-direction: column; gap: 20px; }
  .nav {
    display: flex; align-items: center; justify-content: space-between;
    padding-bottom: 14px; border-bottom: 1px solid #e4e4e7;
  }
  .nav-left { display: flex; align-items: center; gap: 16px; font-size: 13px; color: #71717a; }
  .nav-left strong { color: #18181b; font-weight: 600; letter-spacing: -0.02em; }
  .nav-left span.active { color: #18181b; font-weight: 500; }
  .hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; padding: 6px 0; }
  .hero h1 { margin: 0 0 6px; font-size: 22px; font-weight: 600; letter-spacing: -0.03em; }
  .hero p { margin: 0; font-size: 13px; color: #71717a; }
  .actions { display: flex; gap: 8px; }
  .btn {
    height: 32px; padding: 0 13px; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer; border: 1px solid #e4e4e7;
  }
  .btn-primary { background: #18181b; color: #ffffff; border-color: #18181b; }
  .btn-accent { background: #7c3aed; color: #ffffff; border-color: #7c3aed; }
  .btn-ghost { background: #ffffff; color: #3f3f46; }
  .split { display: grid; grid-template-columns: 1fr 1.4fr; gap: 16px; }
  .box { background: #ffffff; border: 1px solid #e4e4e7; border-radius: 8px; padding: 16px; }
  .box h2 { margin: 0 0 12px; font-size: 13px; font-weight: 600; color: #18181b; }
  .form { display: flex; flex-direction: column; gap: 10px; }
  .field { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: #71717a; }
  .input {
    height: 32px; padding: 0 10px; border: 1px solid #e4e4e7; border-radius: 6px; background: #fafaf9; color: #18181b; font-size: 12px;
  }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; font-weight: 500; color: #71717a; padding: 7px 8px; border-bottom: 1px solid #e4e4e7; }
  td { padding: 9px 8px; border-bottom: 1px solid #f4f4f5; }
  .pill { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px; font-size: 11px; border: 1px solid #e4e4e7; color: #3f3f46; }
  .dot { width: 6px; height: 6px; border-radius: 999px; }
  .dot-violet { background: #7c3aed; }
  .dot-ink { background: #18181b; }
  .dot-muted { background: #a1a1aa; }
  .footer { display: flex; justify-content: space-between; padding-top: 12px; border-top: 1px solid #e4e4e7; font-size: 11px; color: #71717a; }
</style>
</head>
<body>
  <div class="page">
    <nav class="nav">
      <div class="nav-left">
        <strong>Linear Workspace</strong>
        <span class="active">Roadmap</span>
        <span>Issues</span>
        <span>Cycles</span>
      </div>
      <button class="btn btn-accent" type="button">New Issue</button>
    </nav>
    <section class="hero">
      <div>
        <h1>Q4 Core Architecture</h1>
        <p>纸墨黑白灰、高留白、1px 细线分隔与单一紫罗兰强调色。</p>
      </div>
      <div class="actions">
        <button class="btn btn-primary" type="button">发布里程碑</button>
        <button class="btn btn-ghost" type="button">分享视图</button>
      </div>
    </section>
    <div class="split">
      <section class="box">
        <h2>快速录入议题</h2>
        <form class="form">
          <label class="field">标题<input class="input" value="Refactor session projection fold" readonly></label>
          <label class="field">迭代周期<input class="input" value="Cycle 24 · Nov" readonly></label>
          <button class="btn btn-primary" type="button">创建草稿</button>
        </form>
      </section>
      <section class="box">
        <h2>迭代任务流</h2>
        <table>
          <thead><tr><th>编号</th><th>摘要</th><th>状态</th></tr></thead>
          <tbody>
            <tr><td>ENG-104</td><td>Token 引擎增量刷新</td><td><span class="pill"><span class="dot dot-violet"></span>进行中</span></td></tr>
            <tr><td>ENG-108</td><td>快捷键命令面板</td><td><span class="pill"><span class="dot dot-ink"></span>已完成</span></td></tr>
            <tr><td>ENG-112</td><td>离线草稿同步</td><td><span class="pill"><span class="dot dot-muted"></span>待排期</span></td></tr>
          </tbody>
        </table>
      </section>
    </div>
    <footer class="footer"><span>Minimal Linear Tokens · 1px Hairline</span><span>Synced 2m ago</span></footer>
  </div>
</body>
</html>`

const MOBILE_CARD_PREVIEW = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>移动轻量卡片样板</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    padding: 16px;
    background: #eef2f7;
    color: #0f172a;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
    display: flex;
    justify-content: center;
    align-items: flex-start;
  }
  .phone {
    width: 100%;
    max-width: 390px;
    background: #f8fafc;
    border-radius: 28px;
    border: 1px solid #dbe4f0;
    box-shadow: 0 18px 40px -18px rgba(15, 23, 42, 0.22);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .topnav {
    padding: 14px 18px;
    background: #ffffff;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid #f1f5f9;
  }
  .topnav strong { font-size: 16px; }
  .chip { padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; background: #e0f2fe; color: #0369a1; }
  .content { padding: 14px; display: flex; flex-direction: column; gap: 12px; }
  .hero-card {
    padding: 18px; border-radius: 20px; color: #ffffff;
    background: linear-gradient(135deg, #0ea5e9, #14b8a6);
  }
  .hero-card h1 { margin: 0 0 6px; font-size: 18px; }
  .hero-card p { margin: 0 0 14px; font-size: 12px; opacity: 0.92; }
  .cta {
    width: 100%; min-height: 44px; border: 0; border-radius: 14px;
    background: #ffffff; color: #0f172a; font-size: 14px; font-weight: 700; cursor: pointer;
  }
  .card {
    background: #ffffff; border-radius: 18px; padding: 14px; border: 1px solid #e2e8f0;
    display: flex; flex-direction: column; gap: 10px;
  }
  .card h2 { margin: 0; font-size: 14px; }
  .input {
    width: 100%; height: 40px; padding: 0 12px; border-radius: 12px; border: 1px solid #cbd5e1;
    background: #f8fafc; font-size: 13px; color: #0f172a;
  }
  .btn-soft {
    width: 100%; min-height: 40px; border: 0; border-radius: 12px;
    background: #0ea5e9; color: #ffffff; font-size: 13px; font-weight: 600; cursor: pointer;
  }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; color: #64748b; padding: 6px 4px; border-bottom: 1px solid #f1f5f9; }
  td { padding: 8px 4px; border-bottom: 1px solid #f8fafc; }
  .status-ok { color: #059669; font-weight: 600; }
  .status-wait { color: #d97706; font-weight: 600; }
  .tabbar {
    display: grid; grid-template-columns: repeat(4, 1fr); padding: 10px 8px 12px;
    background: #ffffff; border-top: 1px solid #e2e8f0; text-align: center; font-size: 11px; color: #64748b;
  }
  .tabbar span.active { color: #0ea5e9; font-weight: 700; }
  .foot-note { text-align: center; font-size: 11px; color: #94a3b8; padding-bottom: 6px; }
</style>
</head>
<body>
  <div class="phone">
    <header class="topnav"><strong>随行待办</strong><span class="chip">H5 卡片流</span></header>
    <main class="content">
      <section class="hero-card">
        <h1>今日轻办公看板</h1>
        <p>大圆角卡片、高触控按钮与底部四标签导航。</p>
        <button class="cta" type="button">立即打卡 · 开始处理</button>
      </section>
      <section class="card">
        <h2>快速预约会议室</h2>
        <input class="input" value="A302 灵感玻璃房 · 14:30" readonly>
        <button class="btn-soft" type="button">确认预约</button>
      </section>
      <section class="card">
        <h2>今日日程清单</h2>
        <table>
          <thead><tr><th>事项</th><th>时间</th><th>状态</th></tr></thead>
          <tbody>
            <tr><td>设计走查</td><td>10:00</td><td class="status-ok">已完成</td></tr>
            <tr><td>版本评审</td><td>15:30</td><td class="status-wait">待开始</td></tr>
          </tbody>
        </table>
      </section>
      <footer class="foot-note">Mobile Card UI · Safe Area Ready</footer>
    </main>
    <nav class="tabbar">
      <span class="active">首页</span><span>日程</span><span>消息</span><span>我的</span>
    </nav>
  </div>
</body>
</html>`

/** 默认内置素材库实例（heroui-glass）。 */
export const DEFAULT_PROTOTYPE_LIBRARY: PrototypeLibrary = {
  id: 'heroui-glass',
  name: translate('zh', 'protoLib.builtin.heroui-glass.name'),
  summary: translate('zh', 'protoLib.builtin.heroui-glass.summary'),
  tags: [
    translate('zh', 'protoLib.builtin.heroui-glass.tag1'),
    translate('zh', 'protoLib.builtin.heroui-glass.tag2'),
    translate('zh', 'protoLib.builtin.heroui-glass.tag3'),
  ],
  builtin: true,
  palette: ['#6366F1', '#F97316', '#0F172A', '#E2E8F0', '#10B981'],
  designTokens: [
    'canvas-bg: radial ambient glow + #0B1120 (or frosted light #F4F7FB)',
    'surface-glass: rgba(255, 255, 255, 0.08); backdrop-filter: blur(18px)',
    'border-glass: 1px solid rgba(255, 255, 255, 0.16)',
    'radius-card: 18px; radius-pill: 999px; radius-input: 10px',
    'accent-primary: #6366F1; accent-warm: #F97316; success: #10B981',
    'shadow-elevated: 0 1px 0 rgba(255,255,255,0.14) inset, 0 18px 40px -18px rgba(2,6,23,0.72)',
  ].join('\n'),
  componentGuidelines: [
    '1. 顶部导航与主视觉区使用毛玻璃卡片（border-radius: 18px + 1px 半透明描边），不嵌套多层强阴影。',
    '2. 主按钮采用胶囊圆角（border-radius: 999px）与柔和渐变主色；次按钮用半透明玻璃底。',
    '3. 核心功能区采用 Bento 网格卡片（2 列或自适应列），内嵌指标卡与紧凑表单输入控件。',
    '4. 内容列表区表格保持横向留白、细分隔线与胶囊状态徽章（成功绿、警示琥珀、进行紫蓝）。',
  ].join('\n'),
  previewHtml: HEROUI_GLASS_PREVIEW,
}

/** 内置 4 套组件素材库；第一套 heroui-glass 为默认库。 */
export const BUILTIN_PROTOTYPE_LIBRARIES: readonly PrototypeLibrary[] = [
  DEFAULT_PROTOTYPE_LIBRARY,
  {
    id: 'enterprise-admin',
    name: translate('zh', 'protoLib.builtin.enterprise-admin.name'),
    summary: translate('zh', 'protoLib.builtin.enterprise-admin.summary'),
    tags: [
      translate('zh', 'protoLib.builtin.enterprise-admin.tag1'),
      translate('zh', 'protoLib.builtin.enterprise-admin.tag2'),
      translate('zh', 'protoLib.builtin.enterprise-admin.tag3'),
    ],
    builtin: true,
    palette: ['#1D4ED8', '#0F172A', '#F3F6FB', '#DBE3EF', '#047857'],
    designTokens: [
      'canvas-bg: #F3F6FB; panel-bg: #FFFFFF; topbar-bg: #0F172A',
      'border-hairline: 1px solid #DBE3EF; border-input: 1px solid #CBD5E1',
      'radius-panel: 6px; radius-control: 4px; radius-tag: 3px',
      'primary: #1D4ED8; text-main: #0F172A; text-muted: #64748B',
      'semantic: success #047857 / #ECFDF5; warning #B45309 / #FFFBEB',
    ].join('\n'),
    componentGuidelines: [
      '1. 顶部采用深蓝灰导航条（44px 高），下方以 12px 间距铺设高密度白底面板。',
      '2. 筛选表单采用多列等高紧凑栅格（30px 控件高度，4px 小圆角），支持查询与重置按钮对齐。',
      '3. 数据表格采用表头浅灰底（#F8FAFC）、等宽数字对齐（tabular-nums）与紧凑行高（7px 上下内边距）。',
      '4. 状态徽章采用小圆角矩形标签（3px 圆角 + 1px 浅色描边），禁止使用重阴影与大模糊效果。',
    ].join('\n'),
    previewHtml: ENTERPRISE_ADMIN_PREVIEW,
  },
  {
    id: 'minimal-linear',
    name: translate('zh', 'protoLib.builtin.minimal-linear.name'),
    summary: translate('zh', 'protoLib.builtin.minimal-linear.summary'),
    tags: [
      translate('zh', 'protoLib.builtin.minimal-linear.tag1'),
      translate('zh', 'protoLib.builtin.minimal-linear.tag2'),
      translate('zh', 'protoLib.builtin.minimal-linear.tag3'),
    ],
    builtin: true,
    palette: ['#18181B', '#7C3AED', '#FAFAF9', '#E4E4E7', '#71717A'],
    designTokens: [
      'canvas-bg: #FAFAF9; surface: #FFFFFF; border: 1px solid #E4E4E7',
      'text-primary: #18181B; text-muted: #71717A; divider: #F4F4F5',
      'accent-single: #7C3AED; primary-cta: #18181B',
      'radius-box: 8px; radius-control: 6px; shadow: none',
      'typography: letter-spacing -0.02em on headings, generous whitespace',
    ].join('\n'),
    componentGuidelines: [
      '1. 整体采用纸墨黑白灰视觉基底，页面保留充分留白（20px–28px 外边距），卡片之间使用 1px 细线边框而非阴影。',
      '2. 主行动按钮用纯黑（#18181B）或唯一紫罗兰强调色（#7C3AED），避免多色花哨渐变。',
      '3. 列表与表格行去掉斑马纹，仅用极浅 1px 底部分隔线，状态用「6px 圆点 + 细框胶囊」表达。',
      '4. 表单输入保持浅灰底（#FAFAF9）与 32px 高度，标题字重克制在 500–600。',
    ].join('\n'),
    previewHtml: MINIMAL_LINEAR_PREVIEW,
  },
  {
    id: 'mobile-card',
    name: translate('zh', 'protoLib.builtin.mobile-card.name'),
    summary: translate('zh', 'protoLib.builtin.mobile-card.summary'),
    tags: [
      translate('zh', 'protoLib.builtin.mobile-card.tag1'),
      translate('zh', 'protoLib.builtin.mobile-card.tag2'),
      translate('zh', 'protoLib.builtin.mobile-card.tag3'),
    ],
    builtin: true,
    palette: ['#0EA5E9', '#14B8A6', '#F8FAFC', '#0F172A', '#D97706'],
    designTokens: [
      'viewport-shell: max-width 390px centered; app-bg: #F8FAFC; card-bg: #FFFFFF',
      'radius-shell: 28px; radius-card: 18px–20px; radius-cta: 14px',
      'touch-target-min: 40px–44px height; card-gap: 12px',
      'accent-gradient: linear-gradient(135deg, #0EA5E9, #14B8A6)',
      'text-primary: #0F172A; text-muted: #64748B',
    ].join('\n'),
    componentGuidelines: [
      '1. 页面主体收束在居中 390px 移动视口容器内，模拟真实 H5 / 小程序单列卡片流。',
      '2. 卡片统一使用 18px–20px 大圆角与 14px 内边距，主视觉卡采用晴空蓝到青绿渐变。',
      '3. 主按钮与表单输入框遵循大触控尺寸（高 40px–44px，100% 宽度，12px–14px 圆角）。',
      '4. 底部必须保留 4 等分 Tab 导航栏，列表表格精简到 3 列以内保证移动端单屏可读。',
    ].join('\n'),
    previewHtml: MOBILE_CARD_PREVIEW,
  },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBuiltinId(id: string): boolean {
  return BUILTIN_PROTOTYPE_LIBRARIES.some(lib => lib.id === id)
}

function notifyLibraryChange(): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  window.dispatchEvent(new Event(LIBRARY_CHANGE_EVENT))
}

function defaultStorage(storage?: LibraryStorage): LibraryStorage | undefined {
  return storage ?? browserStorage()
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(item => item !== '')
}

function parseCustomLibrary(value: unknown): PrototypeLibrary | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || value.id.trim() === '') return null
  const id = value.id.trim()
  if (isBuiltinId(id)) return null
  if (typeof value.name !== 'string' || value.name.trim() === '') return null
  if (typeof value.designTokens !== 'string' || typeof value.componentGuidelines !== 'string') return null
  const summary = typeof value.summary === 'string' ? value.summary : ''
  const previewHtml = typeof value.previewHtml === 'string' ? value.previewHtml : ''
  const tags = normalizeStringArray(value.tags)
  const paletteRaw = normalizeStringArray(value.palette)
  const palette = paletteRaw.length > 0 ? paletteRaw : [...DEFAULT_FALLBACK_PALETTE]
  const updatedAt = typeof value.updatedAt === 'string' && value.updatedAt.trim() !== ''
    ? value.updatedAt
    : undefined
  return {
    id,
    name: value.name.trim(),
    summary: summary.trim(),
    tags,
    builtin: false,
    palette,
    designTokens: value.designTokens,
    componentGuidelines: value.componentGuidelines,
    previewHtml,
    ...(updatedAt === undefined ? {} : { updatedAt }),
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** 将未知色值收敛为安全的 CSS 颜色串，避免破坏属性引号。 */
function safeCssColor(color: string, fallback: string): string {
  const trimmed = color.trim()
  return /^#[0-9a-fA-F]{3,8}$/.test(trimmed) ? trimmed : fallback
}

/**
 * 解析逗号或中文逗号分隔的标签 / 色板输入。
 * @param raw - 用户输入的字符串。
 * @returns 去空白去重后的条目数组。
 */
export function parseCommaList(raw: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const part of raw.split(/[,，\n]+/)) {
    const item = part.trim()
    if (item === '' || seen.has(item)) continue
    seen.add(item)
    result.push(item)
  }
  return result
}

/**
 * 解析素材库在当前语言下的展示名称、简介与标签。
 * 内置库统一从词典读取，自定义库返回用户保存的内容。
 * @param library - 素材库对象。
 * @param t - 当前界面语言的取词函数。
 * @returns 展示用的名称、简介与标签数组。
 */
export function resolveLibraryCopy(
  library: PrototypeLibrary,
  t: Translate,
): { readonly name: string; readonly summary: string; readonly tags: readonly string[] } {
  const keys = library.builtin ? BUILTIN_COPY_KEYS[library.id] : undefined
  if (keys === undefined) {
    return {
      name: library.name,
      summary: library.summary,
      tags: library.tags,
    }
  }
  return {
    name: t(keys.nameKey),
    summary: t(keys.summaryKey),
    tags: keys.tagKeys.map(key => t(key)),
  }
}

/**
 * 生成自定义库未填预览 HTML 时的默认单文件沙箱样板（零 JS、零外链）。
 * @param library - 素材库数据。
 * @param copy - 可选的已本地化展示文案。
 * @returns 可直接写入 iframe srcDoc 的完整单文件 HTML。
 */
export function effectivePreviewHtml(
  library: PrototypeLibrary,
  copy?: { readonly name: string; readonly summary: string },
): string {
  if (library.previewHtml.trim() !== '') return library.previewHtml
  const primary = safeCssColor(library.palette[0] ?? '#6366F1', '#6366F1')
  const secondary = safeCssColor(library.palette[1] ?? '#0F172A', '#0F172A')
  const surface = safeCssColor(library.palette[2] ?? '#F8FAFC', '#F8FAFC')
  const name = escapeHtml(copy?.name ?? library.name)
  const summary = escapeHtml(copy?.summary ?? library.summary)
  const swatches = (library.palette.length > 0 ? library.palette : DEFAULT_FALLBACK_PALETTE)
    .map((color) => {
      const safe = safeCssColor(color, '#6366F1')
      return `<span class="swatch"><i style="background:${safe}"></i>${escapeHtml(safe)}</span>`
    })
    .join('')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${name}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 20px; background: ${surface}; color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .wrap { max-width: 820px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
  .nav, .card, .footer { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; }
  .nav { display: flex; align-items: center; justify-content: space-between; }
  .hero { background: ${secondary}; color: #ffffff; border-radius: 14px; padding: 18px 20px; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  .hero h1 { margin: 0 0 4px; font-size: 18px; }
  .hero p { margin: 0; font-size: 12px; opacity: 0.85; }
  .btn { border: 0; border-radius: 8px; padding: 8px 14px; font-size: 12px; font-weight: 600; background: ${primary}; color: #ffffff; }
  .swatches { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .swatch { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; border: 1px solid #e2e8f0; font-size: 11px; background: #f8fafc; }
  .swatch i { display: inline-block; width: 10px; height: 10px; border-radius: 999px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 8px; border-bottom: 1px solid #f1f5f9; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; background: ${primary}22; color: ${primary}; }
  .footer { font-size: 11px; color: #64748b; display: flex; justify-content: space-between; }
</style>
</head>
<body>
  <div class="wrap">
    <nav class="nav"><strong>${name}</strong><span>Preview</span></nav>
    <section class="hero">
      <div><h1>${name}</h1><p>${summary}</p></div>
      <button class="btn" type="button">Primary</button>
    </section>
    <section class="card">
      <strong>Palette</strong>
      <div class="swatches">${swatches}</div>
    </section>
    <section class="card">
      <table>
        <thead><tr><th>Component</th><th>Token</th><th>Status</th></tr></thead>
        <tbody><tr><td>Button</td><td>${escapeHtml(primary)}</td><td><span class="badge">Ready</span></td></tr></tbody>
      </table>
    </section>
    <footer class="footer"><span>${name}</span><span>Sandbox Preview</span></footer>
  </div>
</body>
</html>`
}

/**
 * 从 localStorage 读取自定义素材库和默认库偏好；损坏或未知数据自动容错回退。
 * @param storage - 可选存储实现，缺省取浏览器 localStorage。
 * @returns 合并内置与自定义库后的完整状态。
 */
export function loadPrototypeLibraryState(storage?: LibraryStorage): PrototypeLibraryState {
  const store = defaultStorage(storage)
  let customLibraries: PrototypeLibrary[] = []
  if (store !== undefined) {
    let rawLibraries: string | null = null
    try {
      rawLibraries = store.getItem(PROTOTYPE_LIBRARIES_STORAGE_KEY)
    } catch (error: unknown) {
      // 存储不可用时退回空自定义列表，不影响内置库使用。
      void error
      rawLibraries = null
    }
    if (rawLibraries !== null && rawLibraries.trim() !== '') {
      try {
        const parsed: unknown = JSON.parse(rawLibraries)
        if (Array.isArray(parsed)) {
          const seen = new Set<string>()
          for (const entry of parsed) {
            const normalized = parseCustomLibrary(entry)
            if (normalized === null || seen.has(normalized.id)) continue
            seen.add(normalized.id)
            customLibraries.push(normalized)
          }
        }
      } catch (error: unknown) {
        // 脏 JSON 数据直接忽略，避免阻塞页面启动。
        void error
        customLibraries = []
      }
    }
  }

  const libraries: readonly PrototypeLibrary[] = [...BUILTIN_PROTOTYPE_LIBRARIES, ...customLibraries]
  let rawDefault: string | null = null
  if (store !== undefined) {
    try {
      rawDefault = store.getItem(PROTOTYPE_DEFAULT_LIBRARY_STORAGE_KEY)
    } catch (error: unknown) {
      void error
      rawDefault = null
    }
  }
  const validDefault = rawDefault !== null && libraries.some(lib => lib.id === rawDefault)
    ? rawDefault
    : DEFAULT_PROTOTYPE_LIBRARY_ID

  return {
    libraries,
    customLibraries,
    defaultLibraryId: validDefault,
  }
}

/**
 * 持久化自定义素材库列表（自动强制 builtin: false 并过滤与内置冲突的标识）。
 * @param libraries - 待保存的自定义素材库集合。
 * @param storage - 可选存储实现。
 * @returns 归一化并成功写入后的自定义素材库数组。
 */
export function saveCustomLibraries(
  libraries: readonly PrototypeLibrary[],
  storage?: LibraryStorage,
): PrototypeLibrary[] {
  const seen = new Set<string>()
  const sanitized: PrototypeLibrary[] = []
  for (const item of libraries) {
    const normalized = parseCustomLibrary({ ...item, builtin: false })
    if (normalized === null || seen.has(normalized.id)) continue
    seen.add(normalized.id)
    sanitized.push(normalized)
  }
  const store = defaultStorage(storage)
  if (store !== undefined) {
    try {
      store.setItem(PROTOTYPE_LIBRARIES_STORAGE_KEY, JSON.stringify(sanitized))
    } catch (error: unknown) {
      // 配额不足或被禁用时忽略写入失败，不中断调用方状态。
      void error
    }
  }
  notifyLibraryChange()
  return sanitized
}

/**
 * 设置全局默认组件素材库标识；目标不存在时自动回落到 heroui-glass。
 * @param id - 目标素材库 id。
 * @param storage - 可选存储实现。
 * @returns 最终生效的默认素材库 id。
 */
export function setDefaultPrototypeLibraryId(id: string, storage?: LibraryStorage): string {
  const store = defaultStorage(storage)
  const current = loadPrototypeLibraryState(store)
  const resolvedId = current.libraries.some(lib => lib.id === id) ? id : DEFAULT_PROTOTYPE_LIBRARY_ID
  if (store !== undefined) {
    try {
      store.setItem(PROTOTYPE_DEFAULT_LIBRARY_STORAGE_KEY, resolvedId)
    } catch (error: unknown) {
      void error
    }
  }
  notifyLibraryChange()
  return resolvedId
}

function generateCustomId(existing: readonly PrototypeLibrary[]): string {
  const taken = new Set(existing.map(lib => lib.id))
  for (let index = 1; index < 10000; index += 1) {
    const candidate = `custom-${Date.now().toString(36)}-${String(index)}`
    if (!taken.has(candidate)) return candidate
  }
  return `custom-${String(Date.now())}`
}

function buildCustomLibrary(id: string, draft: PrototypeLibraryDraft): PrototypeLibrary {
  const palette = draft.palette.length > 0 ? [...draft.palette] : [...DEFAULT_FALLBACK_PALETTE]
  return {
    id,
    name: draft.name.trim(),
    summary: draft.summary.trim(),
    tags: [...draft.tags],
    builtin: false,
    palette,
    designTokens: draft.designTokens.trim(),
    componentGuidelines: draft.componentGuidelines.trim(),
    previewHtml: draft.previewHtml,
    updatedAt: new Date().toISOString(),
  }
}

/**
 * 新建一条自定义组件素材库并持久化。
 * @param draft - 表单字段。
 * @param storage - 可选存储实现。
 * @returns 更新后的完整状态与新建对象。
 */
export function createCustomLibrary(
  draft: PrototypeLibraryDraft,
  storage?: LibraryStorage,
): { readonly state: PrototypeLibraryState; readonly created: PrototypeLibrary } {
  const current = loadPrototypeLibraryState(storage)
  const id = generateCustomId(current.libraries)
  const created = buildCustomLibrary(id, draft)
  saveCustomLibraries([...current.customLibraries, created], storage)
  return { state: loadPrototypeLibraryState(storage), created }
}

/**
 * 更新一条已存在的自定义组件素材库；内置库不可修改。
 * @param id - 目标自定义库 id。
 * @param draft - 更新后的字段。
 * @param storage - 可选存储实现。
 * @returns 更新后的完整状态。
 */
export function updateCustomLibrary(
  id: string,
  draft: PrototypeLibraryDraft,
  storage?: LibraryStorage,
): PrototypeLibraryState {
  const current = loadPrototypeLibraryState(storage)
  const existing = current.customLibraries.find(lib => lib.id === id)
  if (existing === undefined) return current
  const updated = buildCustomLibrary(id, draft)
  saveCustomLibraries(
    current.customLibraries.map(lib => lib.id === id ? updated : lib),
    storage,
  )
  return loadPrototypeLibraryState(storage)
}

/**
 * 基于任意内置或自定义素材库复制出一份新的自定义库。
 * @param source - 源素材库。
 * @param name - 新库名称。
 * @param storage - 可选存储实现。
 * @param overrides - 可选覆盖字段。
 * @returns 更新后的完整状态与新复制出的素材库。
 */
export function duplicatePrototypeLibrary(
  source: PrototypeLibrary,
  name: string,
  storage?: LibraryStorage,
  overrides?: Partial<PrototypeLibraryDraft>,
): { readonly state: PrototypeLibraryState; readonly created: PrototypeLibrary } {
  return createCustomLibrary({
    name,
    summary: overrides?.summary ?? source.summary,
    tags: overrides?.tags ?? [...source.tags],
    palette: overrides?.palette ?? [...source.palette],
    designTokens: overrides?.designTokens ?? source.designTokens,
    componentGuidelines: overrides?.componentGuidelines ?? source.componentGuidelines,
    previewHtml: overrides?.previewHtml ?? source.previewHtml,
  }, storage)
}

/**
 * 删除一条自定义组件素材库；内置库不可删除，若删掉的是当前默认库则回退到 heroui-glass。
 * @param id - 目标自定义库 id。
 * @param storage - 可选存储实现。
 * @returns 删除后的完整状态。
 */
export function deleteCustomLibrary(id: string, storage?: LibraryStorage): PrototypeLibraryState {
  const current = loadPrototypeLibraryState(storage)
  if (isBuiltinId(id)) return current
  const nextCustom = current.customLibraries.filter(lib => lib.id !== id)
  if (nextCustom.length === current.customLibraries.length) return current
  saveCustomLibraries(nextCustom, storage)
  if (current.defaultLibraryId === id) {
    setDefaultPrototypeLibraryId(DEFAULT_PROTOTYPE_LIBRARY_ID, storage)
  }
  return loadPrototypeLibraryState(storage)
}

/**
 * 按 id 解析素材库；未传或未找到时回落到状态默认库（最终兜底为 heroui-glass）。
 * @param id - 目标素材库 id。
 * @param state - 可选素材库状态快照。
 * @returns 匹配的素材库对象。
 */
export function resolvePrototypeLibrary(
  id: string | undefined,
  state?: PrototypeLibraryState,
): PrototypeLibrary {
  const resolved = state ?? loadPrototypeLibraryState()
  if (id !== undefined) {
    const direct = resolved.libraries.find(lib => lib.id === id)
    if (direct !== undefined) return direct
  }
  return resolved.libraries.find(lib => lib.id === resolved.defaultLibraryId) ?? DEFAULT_PROTOTYPE_LIBRARY
}

/**
 * 订阅本地组件素材库与默认偏好变化的 React Hook。
 * @returns 当前最新的素材库列表与默认库 id。
 */
export function usePrototypeLibraryState(): PrototypeLibraryState {
  const [state, setState] = useState<PrototypeLibraryState>(() => loadPrototypeLibraryState())

  useEffect(() => {
    const sync = (): void => {
      setState(loadPrototypeLibraryState())
    }
    const onStorage = (event: StorageEvent): void => {
      if (
        event.key === null
        || event.key === PROTOTYPE_LIBRARIES_STORAGE_KEY
        || event.key === PROTOTYPE_DEFAULT_LIBRARY_STORAGE_KEY
      ) {
        sync()
      }
    }
    window.addEventListener(LIBRARY_CHANGE_EVENT, sync)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(LIBRARY_CHANGE_EVENT, sync)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  return state
}
