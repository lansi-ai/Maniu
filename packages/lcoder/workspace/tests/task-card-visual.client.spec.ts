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

it('only the two statuses that need a human get an outline, and they get different ones', () => {
  for (const status of STATUSES) {
    const className = runningCardClass(status)
    if (status === 'running' || status === 'awaitingInteraction') expect(className, status).toBeTruthy()
    else expect(className, status).toBeUndefined()
  }
  expect(runningCardClass('running')).not.toBe(runningCardClass('awaitingInteraction'))
})
