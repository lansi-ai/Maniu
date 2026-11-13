export {
  Acceptance,
  AgentsRegistry,
  Command,
  Contract,
  Credential,
  Env,
  ExecPolicy,
  FoundAt,
  Guard,
  JobRole,
  JobRoleId,
  ProjectInfo,
  ProjectTrack,
  RolesFile,
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

export { BUILTIN_ROLES, ROLE_ID_PATTERN, isBuiltinRole } from './roles.js'
export type { BuiltinRoleId } from './roles.js'

export { BUILTIN_TRACKS, BUILTIN_TRACK_IDS, TRACK_ID_PATTERN, builtinTrackName, isBuiltinTrack } from './tracks.js'
export type { BuiltinTrackId, TrackDescriptor } from './tracks.js'

export { formatIssues, validateSpec } from './validate.js'
export type { LoadedFile, Severity, ValidationIssue, ValidationResult } from './validate.js'
