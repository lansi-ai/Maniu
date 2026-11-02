export {
  Acceptance,
  Command,
  Contract,
  Credential,
  Env,
  ExecPolicy,
  FoundAt,
  Guard,
  RuleEntry,
  RuleKind,
  RuleStatus,
  RulesFile,
  Signature,
  SpecLayout,
  StateMachine,
  Task,
  TaskGrade,
  TaskState,
  Transition,
} from './spec.js'

export { formatIssues, validateSpec } from './validate.js'
export type { LoadedFile, Severity, ValidationIssue, ValidationResult } from './validate.js'
