/** 任务页：六列看板与列表，筛选共用一份投影。 */

import { useMemo, useState } from 'react'
import type { JSX } from 'react'
import { Button, Card, Chip, Input, ListBox, Select, Table, Tabs } from '@heroui/react'
import type { ProjectScope } from '../workspace/use-workspaces.ts'
import type { SpecProjection } from '../spec/load.ts'
import type { TaskRow } from '../spec/rows.ts'
import type { SessionSummary } from '../store.ts'
import {
  BOARD_COLUMNS, STATE_LABELS, boardColumnOf, emptyTaskFilter, filterTasks, runStatusOf, sortTasks,
  type TaskFilter,
} from '../spec/board.ts'
import { translate, type Translate } from '../locale.ts'
import { TaskDetail } from './task-detail.tsx'
import { ReaderOverlay } from './reader.tsx'
import { FlowPanel } from './flow-panel.tsx'

/** 任务页属性。 */
export interface TasksPageProps {
  readonly project: ProjectScope | null
  readonly projection: SpecProjection
  readonly sessions: readonly SessionSummary[]
  readonly loading: boolean
  readonly error: string | null
  readonly onReload: () => void
  /** 只显示该需求关联的任务；null 表示不过滤。 */
  readonly requirementFilter: string | null
  readonly onClearRequirementFilter: () => void
  /** 取词函数；缺省为中文词典。 */
  readonly t?: Translate
}

/**
 * 任务页。
 * @param props - 投影、会话列表与项目。
 * @returns 页面。
 */
export function TasksPage(props: TasksPageProps): JSX.Element {
  const t = props.t ?? ((key, params) => translate('zh', key, params))
  const [view, setView] = useState<'board' | 'list'>('board')
  const [filter, setFilter] = useState<TaskFilter>(emptyTaskFilter)
  const [selected, setSelected] = useState<string | null>(null)
  const [readerPath, setReaderPath] = useState<string | null>(null)
  const [flowOpen, setFlowOpen] = useState(false)

  const running = useMemo(
    () => new Set(props.sessions.filter(session => session.running).map(session => session.sessionId)),
    [props.sessions],
  )
  const rows = useMemo(() => {
    const matched = filterTasks(props.projection.tasks, filter)
    return sortTasks(props.requirementFilter === null
      ? matched
      : matched.filter(task => task.requirement === props.requirementFilter))
  }, [props.projection.tasks, props.requirementFilter, filter])
  const roles = useMemo(
    () => [...new Set(props.projection.roles.map(role => role.id))].sort(),
    [props.projection.roles],
  )
  const active = rows.find(row => row.id === selected) ?? null
  const update = (patch: Partial<TaskFilter>): void => { setFilter(current => ({ ...current, ...patch })) }

  const selectView = (key: unknown): void => {
    if (key !== 'board' && key !== 'list') return
    setView(key)
  }
  const selectGrade = (key: unknown): void => {
    if (key !== 'all' && key !== 'A' && key !== 'B' && key !== 'C') return
    update({ grade: key === 'all' ? '' : key })
  }
  const selectSession = (key: unknown): void => {
    if (typeof key !== 'string') return
    update({ session: key === 'all' ? '' : key })
  }
  const selectRole = (key: unknown): void => {
    if (typeof key !== 'string') return
    update({ role: key === 'all' ? '' : key })
  }

  return (
    <section className="page" data-testid="page-tasks">
      <header className="page-head">
        <div>
          <h2>任务</h2>
          <p className="page-sub">{rows.length} 条任务 · {BOARD_COLUMNS.length} 列看板</p>
        </div>
        <div className="page-actions task-toolbar">
          <Input
            className="toolbar-search"
            data-testid="task-search"
            value={filter.text}
            placeholder="搜索任务"
            variant="secondary"
            onChange={(event) => { update({ text: event.target.value }) }}
          />
          <Select
            className="toolbar-select"
            data-testid="task-grade"
            value={filter.grade === '' ? 'all' : filter.grade}
            onChange={selectGrade}
            aria-label="全部等级"
            variant="secondary"
          >
            <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item key="all" id="all">全部等级</ListBox.Item>
                <ListBox.Item key="A" id="A">A</ListBox.Item>
                <ListBox.Item key="B" id="B">B</ListBox.Item>
                <ListBox.Item key="C" id="C">C</ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
          <Select
            className="toolbar-select"
            data-testid="task-session"
            value={filter.session === '' ? 'all' : filter.session}
            onChange={selectSession}
            aria-label="全部会话"
            variant="secondary"
          >
            <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item key="all" id="all">全部会话</ListBox.Item>
                {props.sessions.map(session => (
                  <ListBox.Item key={session.sessionId} id={session.sessionId}>{session.sessionId.slice(0, 8)}</ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
          <Select
            className="toolbar-select"
            data-testid="task-role"
            value={filter.role === '' ? 'all' : filter.role}
            onChange={selectRole}
            aria-label="全部岗位"
            variant="secondary"
          >
            <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item key="all" id="all">全部岗位</ListBox.Item>
                {roles.map(role => <ListBox.Item key={role} id={role}>{role}</ListBox.Item>)}
              </ListBox>
            </Select.Popover>
          </Select>
          <Tabs className="toolbar-tabs" selectedKey={view} onSelectionChange={selectView} aria-label="任务视图">
            <Tabs.List>
              <Tabs.Tab key="board" id="board" data-testid="task-view-board">看板</Tabs.Tab>
              <Tabs.Tab key="list" id="list" data-testid="task-view-list">列表</Tabs.Tab>
            </Tabs.List>
          </Tabs>
          <Button variant="secondary" data-testid="task-reload" onPress={props.onReload}>
            {props.loading ? '读取中…' : '刷新'}
          </Button>
          <Button variant="secondary" data-testid="flow-open" isDisabled={props.project === null} onPress={() => { setFlowOpen(true) }}>流程</Button>
        </div>
      </header>

      {props.requirementFilter !== null && (
        <div className="filter-bar" data-testid="task-requirement-filter">
          <Chip variant="soft" color="accent">{t('task.requirementFilter', { id: props.requirementFilter })}</Chip>
          <Button
            variant="ghost"
            size="sm"
            data-testid="task-requirement-filter-clear"
            onPress={props.onClearRequirementFilter}
          >
            {t('task.clearRequirementFilter')}
          </Button>
        </div>
      )}

      {props.project === null && <p className="empty" data-testid="task-no-project">先在「切换项目」里打开一个仓库。</p>}
      {props.error !== null && <pre className="problem" data-testid="task-problems">{props.error}</pre>}

      {props.project !== null && view === 'board' && (
        <div className="board task-board-bento" data-testid="task-board">
          {BOARD_COLUMNS.map((column) => {
            const columnRows = rows.filter(row => boardColumnOf(row) === column.id)
            return (
              <Card className="board-column" key={column.id} data-testid="task-column" data-column={column.id}>
                <Card.Header className="board-head">
                  <Card.Title>{column.label}</Card.Title>
                  <span className="count">{columnRows.length}</span>
                </Card.Header>
                <Card.Content className="board-body">
                  {columnRows.map(row => (
                    <TaskCard key={row.id} task={row} running={running} selected={row.id === selected} onOpen={setSelected} />
                  ))}
                  {columnRows.length === 0 && <p className="empty">空</p>}
                </Card.Content>
              </Card>
            )
          })}
        </div>
      )}

      {props.project !== null && view === 'list' && (
        <div className="table-wrap lg-glass-card" data-testid="task-list">
          <Table aria-label="任务列表" className="task-table">
            <Table.Content>
              <Table.Header>
                <Table.Column isRowHeader>编号</Table.Column>
                <Table.Column>标题</Table.Column>
                <Table.Column>列</Table.Column>
                <Table.Column>需求/方案</Table.Column>
                <Table.Column>轨</Table.Column>
                <Table.Column>依赖</Table.Column>
                <Table.Column>开立</Table.Column>
              </Table.Header>
              <Table.Body>
                {rows.map(row => (
                  <Table.Row
                    key={row.id}
                    data-testid="task-row"
                    data-task-id={row.id}
                    className={row.id === selected ? 'selected' : ''}
                    onAction={() => { setSelected(row.id) }}
                  >
                    <Table.Cell className="mono">{row.id}</Table.Cell>
                    <Table.Cell>{row.title}</Table.Cell>
                    <Table.Cell><Chip size="sm" variant="secondary">{columnLabelOf(row)}</Chip></Table.Cell>
                    <Table.Cell>{row.requirement ?? row.proposal ?? '—'}</Table.Cell>
                    <Table.Cell>{row.track ?? '—'}</Table.Cell>
                    <Table.Cell>{row.dependsOn.length === 0 ? '—' : row.dependsOn.join('、')}</Table.Cell>
                    <Table.Cell className="mono">{row.openedAt?.slice(0, 10) ?? '—'}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table>
          {rows.length === 0 && <p className="empty" data-testid="task-empty">没有匹配的任务。</p>}
        </div>
      )}

      {active !== null && props.project !== null && (
        <TaskDetail
          task={active}
          projection={props.projection}
          project={props.project}
          sessions={props.sessions}
          onClose={() => { setSelected(null) }}
          onOpenDoc={setReaderPath}
          onReload={props.onReload}
        />
      )}

      {flowOpen && props.project !== null && (
        <FlowPanel
          project={props.project}
          projection={props.projection}
          onClose={() => { setFlowOpen(false) }}
        />
      )}

      {readerPath !== null && props.project !== null && (
        <ReaderOverlay
          scopeSessionId={props.project.scopeSessionId}
          path={readerPath}
          onClose={() => { setReaderPath(null) }}
        />
      )}
    </section>
  )
}

function columnLabelOf(task: TaskRow): string {
  const id = boardColumnOf(task)
  return BOARD_COLUMNS.find(column => column.id === id)?.label ?? STATE_LABELS[task.state] ?? task.state
}

function TaskCard(props: {
  readonly task: TaskRow
  readonly running: ReadonlySet<string>
  readonly selected: boolean
  readonly onOpen: (id: string) => void
}): JSX.Element {
  const status = runStatusOf(props.task, props.running)
  return (
    <button
      type="button"
      className={props.selected ? 'task-card lg-glass-card lg-sheen active' : 'task-card lg-glass-card lg-sheen'}
      data-testid="task-card"
      data-task-id={props.task.id}
      data-run-status={status}
      onClick={() => { props.onOpen(props.task.id) }}
    >
      <span className="task-card-head">
        <span className="mono">{props.task.id}</span>
        <Chip size="sm" variant="soft" color="accent">{props.task.grade}</Chip>
      </span>
      <span className="task-card-title">{props.task.title}</span>
      <span className="task-card-tags">
        <Chip size="sm" variant="secondary">{STATE_LABELS[props.task.state] ?? props.task.state}</Chip>
        {props.task.requirement !== undefined && <Chip size="sm" variant="secondary">{props.task.requirement}</Chip>}
        {props.task.track !== undefined && <Chip size="sm" variant="secondary">轨 {props.task.track}</Chip>}
        {props.task.role !== undefined && <Chip size="sm" variant="secondary">岗位 {props.task.role}</Chip>}
        {status === 'running' && <Chip size="sm" variant="soft" color="success">运行中</Chip>}
        {status === 'queued' && <Chip size="sm" variant="soft" color="warning">已认领</Chip>}
      </span>
    </button>
  )
}
