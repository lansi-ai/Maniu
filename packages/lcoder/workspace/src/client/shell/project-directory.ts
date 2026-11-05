/**
 * Project repository directory picker.
 *
 * Desktop exposes it through the existing native directory bridge; Web and
 * preloads that only ship the generic picker return undefined, so the project
 * dialog keeps its manual path input.
 */

/** One-shot native directory choice for the project picker. */
export interface ProjectDirectoryPicker {
  /** Open the system folder chooser at the given path; resolves null on cancel or unavailable dialog. */
  pickProjectDirectory(defaultPath?: string): Promise<string | null>
}

/**
 * The project directory picker when the desktop preload exposes it.
 * @returns the picker, or undefined for Web and older preloads.
 */
export function projectDirectoryPicker(): ProjectDirectoryPicker | undefined {
  const bridge = (globalThis as typeof globalThis & {
    __DSH_DIRECTORY_PICKER__?: { readonly pickProjectDirectory?: (defaultPath?: string) => Promise<string | null> }
  }).__DSH_DIRECTORY_PICKER__
  const pick = bridge?.pickProjectDirectory
  return pick === undefined ? undefined : { pickProjectDirectory: pick }
}
