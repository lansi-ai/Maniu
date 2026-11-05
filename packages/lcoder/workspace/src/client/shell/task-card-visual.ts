/**
 * Task card visual state.
 *
 * Only the running card gets the moving outline; every other status keeps the
 * plain card. Keeping the mapping in one function lets the shell and its test
 * agree on which of the six statuses animates.
 */
import type { TaskCardStatus } from '../task-session.ts'
import css from './Shell.module.css'

/**
 * The moving-outline class for a running card.
 * @param status - Card status derived from the host push and session snapshot.
 * @returns the running class, or undefined for every other status.
 */
export function runningCardClass(status: TaskCardStatus): string | undefined {
  return status === 'running' ? css.taskCardRunning : undefined
}
