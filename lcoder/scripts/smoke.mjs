/**
 * LCoder one-shot smoke: build as needed, launch the desktop instance, attach to
 * the renderer over CDP, probe six surfaces, and fail the process when any probe
 * fails.
 *
 * Usage: `lcoder/scripts/smoke.cmd [-NoBuild] [-Build] [-KeepRunning] [-Repair] [-Help]`
 * Ports: `DSH_DESKTOP_RENDERER_DEBUG_PORT` (9582), `DSH_DESKTOP_MAIN_INSPECT_PORT`
 * (9589), `DSH_DESKTOP_HOST_INSPECT_PORT` (9590), `DSH_SMOKE_CLOUD_PORT` (9583).
 * The run never touches AppData, the registry, the main checkout (except the
 * read-only `-Repair` cache copy), or another worktree's processes.
 */
import { appendFileSync, closeSync, mkdirSync, openSync } from 'node:fs'
import { join } from 'node:path'
import { attachRenderer, dom } from './smoke-cdp.mjs'
import { HostRpc, newestSessionHeader } from './smoke-rpc.mjs'
import {
  DESKTOP_LOG, HOME, LOGS, ROOT,
  acquireLock, assertPortsFree, checkEnvironment, childEnvironment, ensureBuild,
  killTree, prepareProfile, releaseLock, resetMock, resolvePorts, sleep,
  startDesktop, startMock, stopOwnInstances, waitMock, waitReady,
} from './smoke-env.mjs'

const HELP = `
LCoder smoke: one command, six probes, non-zero exit on failure.

Usage:
  lcoder\\scripts\\smoke.cmd [-NoBuild] [-Build] [-KeepRunning] [-Repair] [-Help]

Options:
  -NoBuild      skip the build step and run the current artifacts
  -Build        force build:artifacts, layer bundles, and the desktop build
  (default)     build only what is missing or older than its sources
  -KeepRunning  leave the desktop instance running after the probes
  -Repair       copy missing electron/runtime caches from the main checkout
  -Help         print this text

Ports (each one overridable through the environment):
  DSH_DESKTOP_RENDERER_DEBUG_PORT   9582  renderer CDP
  DSH_DESKTOP_MAIN_INSPECT_PORT     9589  electron main inspector
  DSH_DESKTOP_HOST_INSPECT_PORT     9590  host process inspector
  DSH_SMOKE_CLOUD_PORT              9583  local dev mock cloud
  DSH_SMOKE_PROBE_RENDERER_PORT           diagnostic: attach the probes to a
                                          different renderer port (defaults to
                                          DSH_DESKTOP_RENDERER_DEBUG_PORT)

The run stays inside this worktree: desktop home and Electron user data live in
apps/desktop/.desktop-build, logs in lcoder/logs, and the mock cloud listens on
loopback only. It stops this worktree's own desktop instance before and after the
run (unless -KeepRunning), and never touches AppData, the registry, or the main
checkout's instance.
`.trimStart()

const PHONE = '+8613800000097'
const PASSWORD = 'lcoder-smoke-0001'

function parseArguments(argv) {
  const options = { build: 'auto', keepRunning: false, repair: false, help: false }
  for (const argument of argv) {
    if (argument === '-NoBuild') options.build = 'skip'
    else if (argument === '-Build') options.build = 'force'
    else if (argument === '-KeepRunning') options.keepRunning = true
    else if (argument === '-Repair') options.repair = true
    else if (argument === '-Help' || argument === '--help' || argument === '/?') options.help = true
    else throw new Error(`unknown option ${argument}; use -Help`)
  }
  return options
}

function createOutput() {
  mkdirSync(LOGS, { recursive: true })
  const stamp = new Date().toISOString().replaceAll(/[:.]/gu, '-').slice(0, 19)
  const path = join(LOGS, `smoke-${stamp}.log`)
  const descriptor = openSync(path, 'a')
  const write = line => {
    appendFileSync(descriptor, `${line}\n`)
    process.stdout.write(`${line}\n`)
  }
  return { path, write, close: () => closeSync(descriptor) }
}

/** Run one probe, print its ok/not-ok line immediately, and keep the result for the summary. */
async function runProbe(results, write, id, action) {
  try {
    const detail = await action()
    results.push({ id, ok: true })
    write(`ok     ${id} - ${detail}`)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    results.push({ id, ok: false })
    write(`not ok ${id} - ${detail}`)
  }
}

async function openRepository(cdp, repoPath) {
  await cdp.waitFor(`document.querySelector('[class*="topProject"]') !== null`, 30_000, 'top bar project button')
  const opened = await cdp.evaluate(dom.click('[class*="topProject"]'))
  if (!opened) throw new Error('project button did not open the picker')
  await cdp.waitFor(`document.querySelector('[class*="repoInput"]') !== null`, 10_000, 'project picker input')
  const filled = await cdp.evaluate(dom.fill('[class*="repoInput"]', repoPath))
  if (filled !== 'ok') throw new Error(`could not fill the repository path (${String(filled)})`)
  const submitted = await cdp.evaluate(dom.click('[class*="repoOpen"] button[class*="primaryBtn"]'))
  if (!submitted) throw new Error('project picker has no open button')
  try {
    await cdp.waitFor(`document.querySelector('[class*="taskCard"]') !== null`, 60_000,
      'task cards after opening the repository')
    await cdp.waitFor(
      `[...document.querySelectorAll('[class*="taskCard"]')].some(card => (card.innerText ?? '').includes('DEMO-01'))`,
      30_000, 'DEMO-01 task card after opening the repository')
  } catch (error) {
    const problems = await cdp.evaluate(dom.texts('[class*="problem"]')).catch(() => [])
    const detail = Array.isArray(problems) && problems.length > 0 ? `; ui: ${problems.join(' | ')}` : ''
    throw new Error(`${error.message}${detail}`)
  }
}

function headerMatches(header, repoPath) {
  return typeof header.agentPreset === 'string'
    && header.agentPreset.startsWith('lcoder')
    && String(header.cwd ?? '').toLowerCase() === repoPath.toLowerCase()
}

async function waitForHeader(repoPath, since) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const found = newestSessionHeader(HOME, since, header => headerMatches(header, repoPath))
    if (found !== undefined) return found
    await sleep(250)
  }
  throw new Error(`no session header under ${join(HOME, 'sessions')} recorded agentPreset=lcoder for ${repoPath}`)
}

async function waitSignedOut(cdp, rpc) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const state = await rpc.call('lcoderCloud/state').catch(() => undefined)
    const signedIn = state?.ok === true ? state.value?.signedIn === true : undefined
    if (signedIn === true) {
      await rpc.signOut()
      await cdp.evaluate(`window.dispatchEvent(new Event('focus'))`)
      await sleep(400)
      continue
    }
    await cdp.evaluate(`window.dispatchEvent(new Event('focus'))`)
    await sleep(300)
    const ui = await cdp.evaluate(`(() => {
      const button = document.querySelector('[class*="cloudButton"]');
      if (button === null) return { present: false };
      const avatar = button.querySelector('[class*="cloudAvatar"]');
      return {
        present: true,
        signedIn: document.querySelector('[class*="cloudButtonSignedIn"]') !== null,
        loading: (avatar?.innerText ?? '') === '\u2026',
      };
    })()`)
    if (ui?.present === true && ui.signedIn === false && ui.loading === false) {
      await sleep(500)
      const stable = await cdp.evaluate(
        `document.querySelector('[class*="cloudButtonSignedIn"]') === null`)
      if (stable === true) return
    }
  }
  throw new Error('renderer never settled on a signed-out account state')
}

async function main() {
  let options
  try {
    options = parseArguments(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }
  if (options.help) { process.stdout.write(HELP); return 0 }

  const output = createOutput()
  const log = message => output.write(`[smoke] ${message}`)
  const results = []
  const startedAt = Date.now()
  const launchMarker = Date.now() - 1_000
  let desktop
  let mock
  let cdp
  let rpc
  let aborted

  try {
    const ports = resolvePorts(process.env)
    log(`worktree ${ROOT}`)
    log(`ports renderer=${ports.renderer} main=${ports.main} host=${ports.host} cloud=${ports.cloud}`)
    log(`log ${output.path}`)
    acquireLock()
    checkEnvironment({ repair: options.repair, log })
    const environment = childEnvironment(ports)
    stopOwnInstances({ log })
    await assertPortsFree(ports)
    log('ports are free')
    ensureBuild({ mode: options.build, environment, log })
    prepareProfile({ log })
    mock = startMock({ ports, environment, log })
    await waitMock(ports.cloud)
    desktop = startDesktop({ environment })
    log('desktop launcher started; waiting for the ready URL')
    const readyUrl = await waitReady({ child: desktop.child, log })
    const origin = new URL(readyUrl).origin
    log(`ready ${origin}`)
    rpc = await HostRpc.connect(readyUrl)
    // Let the renderer finish its first account-state read before clearing tokens,
    // so the gate probe cannot race a stale signed-in snapshot.
    await sleep(700)
    await rpc.signOut()
    await resetMock(ports.cloud)
    const probeRendererPort = Number(process.env.DSH_SMOKE_PROBE_RENDERER_PORT ?? ports.renderer)
    if (!Number.isSafeInteger(probeRendererPort) || probeRendererPort < 1 || probeRendererPort > 65_535) {
      throw new Error('DSH_SMOKE_PROBE_RENDERER_PORT must be an integer from 1 through 65535')
    }
    let rendererError
    try {
      cdp = await attachRenderer(probeRendererPort, origin, log)
    } catch (error) {
      rendererError = error instanceof Error ? error.message : String(error)
      log(rendererError)
    }
    const requireRenderer = () => {
      if (cdp === undefined) throw new Error(rendererError ?? 'renderer is not attached')
    }

    await runProbe(results, output.write, 'window.up', async () => {
      requireRenderer()
      await cdp.waitFor(
        `document.readyState === 'complete' && document.querySelector('div[data-theme]') !== null`,
        30_000, 'shell root rendered')
      const title = await cdp.evaluate('document.title')
      return `renderer loaded (${origin}, title="${String(title)}")`
    })

    let openError = cdp === undefined ? (rendererError ?? 'renderer is not attached') : undefined
    if (openError === undefined) {
      try {
        log(`opening repository ${ROOT}`)
        await openRepository(cdp, ROOT)
        log('repository opened; board rendered')
      } catch (error) {
        openError = error instanceof Error ? error.message : String(error)
        log(`repository open failed: ${openError}`)
      }
    }

    await runProbe(results, output.write, 'kernel.assembly', async () => {
      if (openError !== undefined) throw new Error(`repository/session open failed: ${openError}`)
      const found = await waitForHeader(ROOT, launchMarker)
      return `session header agentPreset=${String(found.header.agentPreset)} (${found.path.slice(found.path.lastIndexOf('session-'))})`
    })

    await runProbe(results, output.write, 'board.data', async () => {
      if (openError !== undefined) throw new Error(`repository/session open failed: ${openError}`)
      const cards = await cdp.waitFor(
        `(() => {
          const cards = [...document.querySelectorAll('[class*="taskCard"]')];
          return cards.some(card => (card.innerText ?? '').includes('DEMO-01'))
            ? cards.map(card => (card.innerText ?? '').replace(/\\s+/g, ' ').trim())
            : false;
        })()`,
        20_000, 'DEMO-01 task card')
      if (!Array.isArray(cards) || cards.length === 0) throw new Error('board rendered no task cards')
      if (!cards.some(text => text.includes('DEMO-01'))) {
        throw new Error(`board cards do not include DEMO-01: ${cards.slice(0, 3).join(' | ')}`)
      }
      return `${String(cards.length)} task card(s), DEMO-01 present`
    })

    await runProbe(results, output.write, 'task.detail', async () => {
      if (openError !== undefined) throw new Error(`repository/session open failed: ${openError}`)
      const clicked = await cdp.evaluate(dom.clickText('[class*="taskCard"]', 'DEMO-01'))
      if (!clicked) throw new Error('DEMO-01 card not clickable')
      const heading = await cdp.waitFor(
        `(() => {
          const head = document.querySelector('[class*="modalHead"] h3');
          return head !== null && (head.innerText ?? '').includes('DEMO-01') ? (head.innerText ?? '') : false;
        })()`,
        10_000, 'DEMO-01 detail modal')
      await cdp.evaluate(`(() => {
        const heads = [...document.querySelectorAll('[class*="modalHead"]')];
        const head = heads.find(candidate => (candidate.querySelector('h3')?.innerText ?? '').includes('DEMO-01'));
        const button = head === undefined ? null : head.querySelector('button[class*="iconBtn"]');
        if (button !== null) button.click();
      })()`)
      return `detail modal opened: ${String(heading).replaceAll(/\s+/gu, ' ').trim()}`
    })

    await runProbe(results, output.write, 'auth.gate', async () => {
      if (openError !== undefined) throw new Error(`repository/session open failed: ${openError}`)
      await waitSignedOut(cdp, rpc)
      const before = await cdp.evaluate(`document.querySelectorAll('[class*="sessionChip"]').length`)
      const gate = await cdp.evaluate(`(() => {
        const button = document.querySelector('[class*="sessionAdd"]');
        if (button === null) return 'missing';
        if (button.disabled) return 'disabled';
        button.click();
        return 'clicked';
      })()`)
      if (gate !== 'clicked') throw new Error(`new-session button ${String(gate)}`)
      await cdp.waitFor(`document.querySelector('#lcoder-cloud-phone') !== null`, 8_000,
        'login dialog after a gated click')
      const tabs = await cdp.evaluate(`document.querySelectorAll('[role="tablist"]').length`)
      await sleep(700)
      const after = await cdp.evaluate(`document.querySelectorAll('[class*="sessionChip"]').length`)
      if (after !== before) throw new Error(`gated click created a session (${String(before)} -> ${String(after)})`)
      await cdp.evaluate(`(() => {
        const dialog = document.querySelector('[class*="cloudModal"]');
        const head = dialog === null ? null : dialog.querySelector('[class*="modalHead"]');
        const button = head === null ? null : head.querySelector('button[class*="iconBtn"]');
        if (button !== null) button.click();
      })()`)
      await cdp.waitFor(`document.querySelector('#lcoder-cloud-phone') === null`, 5_000, 'login dialog closed')
      return `new-session click blocked by the login dialog (tabs=${String(tabs)}); session count unchanged (${String(before)})`
    })

    await runProbe(results, output.write, 'personal.entry', async () => {
      requireRenderer()
      await rpc.register({ phone: PHONE, password: PASSWORD })
      await cdp.evaluate(`window.dispatchEvent(new Event('focus'))`)
      await cdp.waitFor(`document.querySelector('[class*="cloudButtonSignedIn"]') !== null`, 20_000,
        'signed-in account button after registration')
      const opened = await cdp.evaluate(dom.click('[class*="cloudButton"]'))
      if (!opened) throw new Error('account button not clickable')
      await cdp.waitFor(`document.querySelector('[class*="cloudModal"]') !== null`, 10_000, 'account dialog')
      const clicked = await cdp.evaluate(`(() => {
        const button = document.querySelector('[class*="cloudActions"] button[class*="secondaryBtn"]');
        if (button === null) return false;
        button.click();
        return true;
      })()`)
      if (!clicked) throw new Error('account dialog has no personal-center entry')
      const title = await cdp.waitFor(
        `(() => {
          const page = document.querySelector('[class*="pcPage"]');
          if (page === null) return false;
          return (page.querySelector('[class*="pcTitle"]')?.innerText ?? '').trim();
        })()`,
        15_000, 'personal center page')
      return `account dialog -> personal center page ("${String(title)}")`
    })
  } catch (error) {
    aborted = error instanceof Error ? error.message : String(error)
    log(`run aborted: ${aborted}`)
  } finally {
    try { cdp?.close() } catch { /* closed */ }
    if (!options.keepRunning) {
      if (desktop !== undefined) killTree(desktop)
      stopOwnInstances({ log })
    } else if (desktop !== undefined) {
      try { closeSync(desktop.descriptor) } catch { /* closed */ }
    }
    if (mock !== undefined) killTree(mock)
    releaseLock()
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  if (desktop !== undefined) log(`desktop log ${DESKTOP_LOG}`)
  if (aborted !== undefined) {
    output.write(`smoke: aborted after ${elapsed}s; ${String(results.filter(result => result.ok).length)}/${String(results.length)} probes ok`)
    output.close()
    return 1
  }
  const passed = results.filter(result => result.ok).length
  const failed = results.length - passed
  output.write(`smoke: ${String(passed)}/${String(results.length)} ok in ${elapsed}s${failed === 0 ? '' : ` (${String(failed)} failed)`}`)
  output.write(`smoke: log ${output.path}`)
  if (options.keepRunning) output.write('smoke: desktop left running (-KeepRunning)')
  output.close()
  return failed === 0 ? 0 : 1
}

const code = await main()
process.exitCode = code
