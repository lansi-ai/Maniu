import { expect, it } from 'vitest'
import type { TaskCardStatus } from '../src/client/task-session.ts'
import { runningCardClass } from '../src/client/shell/task-card-visual.ts'

const STATUSES: readonly TaskCardStatus[] = [
  'unstarted',
  'idle',
  'running',
  'awaitingInteraction',
  'awaitingFirstTurn',
  'failed',
]

it('applies the moving outline class to the running card only', () => {
  for (const status of STATUSES) {
    const className = runningCardClass(status)
    if (status === 'running') expect(className, status).toBeTruthy()
    else expect(className, status).toBeUndefined()
  }
})
