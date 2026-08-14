// Source write-policy: a source-scoped, opt-in page contract that agents can
// discover over MCP and that `put_page` enforces before any write.
//
// See policy-v1.ts for the "why this is not a schema pack" note and
// docs/guides/source-write-policy.md for the authoring guide.

export {
  parseWritePolicy,
  WritePolicyParseError,
  type ConnectionRules,
  type ServerManagedField,
  type ServerManagedMode,
  type ServerManagedValue,
  type SlugRules,
  type TypePathRule,
  type WritePolicyV1,
} from './policy-v1.ts';

export {
  loadWritePolicyForSource,
  resolveWritePolicyFromYaml,
  __setWritePolicyOverrideForTests,
  _resetWritePolicyCacheForTests,
  type LoadedWritePolicy,
  type NoPolicyReason,
  type WritePolicyResolution,
} from './load.ts';

export {
  validatePageAgainstPolicy,
  type PolicyViolation,
  type ValidatePageInput,
  type ValidatePageResult,
  type ViolationSeverity,
} from './validate.ts';

export {
  runWritePolicyGate,
  _resetWritePolicySlugCacheForTests,
  type WritePolicyGateInput,
  type WritePolicyGateOutcome,
} from './gate.ts';

export {
  buildNoContract,
  buildWriteContract,
  type NoWriteContract,
  type WriteContract,
} from './contract.ts';
