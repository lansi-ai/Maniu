/**
 * Desktop window chrome bridge.
 *
 * Only the Windows desktop preload exposes it; Web builds and macOS keep their
 * native chrome, so the shell renders window buttons only when this returns a
 * bridge.
 */

/** Window operations accepted by the Windows desktop shell. */
export type DesktopWindowCommand = 'minimize' | 'toggle-maximize' | 'close'

/** Live maximize and fullscreen state of the desktop window. */
export interface DesktopWindowState {
  readonly maximized: boolean
  readonly fullscreen: boolean
}

/** Main-process window operations exposed to the application document. */
export interface DesktopWindowBridge {
  /** Run a window command; close goes through the main process close policy. */
  command(command: DesktopWindowCommand): Promise<void>
  /** Read the current maximize and fullscreen state. */
  state(): Promise<DesktopWindowState>
  /** Subscribe to maximize and fullscreen transitions. */
  subscribe(listener: (state: DesktopWindowState) => void): () => void
}

/**
 * The desktop window bridge, or undefined outside the Windows desktop shell.
 * @returns the exposed bridge when the preload provided one.
 */
export function desktopWindowBridge(): DesktopWindowBridge | undefined {
  return (globalThis as typeof globalThis & { dshDesktop?: { window?: DesktopWindowBridge } }).dshDesktop?.window
}
