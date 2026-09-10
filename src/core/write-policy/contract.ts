// Render a source's write policy as the machine-readable contract an agent
// fetches before its first write to that source.
//
// The contract is a PROJECTION of the policy, not a second source of truth:
// every field here is derived from the same `WritePolicyV1` the gate enforces,
// so "what the agent was told" and "what the server checks" cannot drift.

import type { WritePolicyV1 } from './policy-v1.ts';
import type { NoPolicyReason } from './load.ts';

export interface WriteContract {
  contract_version: string;
  source_id: string;
  enforced: true;
  /** Frontmatter keys the agent must supply itself. */
  required_agent_fields: string[];
  /** Subset of the above (plus optional keys) that must be non-empty lists. */
  non_empty_list_fields: string[];
  /** field → mode. The server fills/preserves these; a supplied value may be ignored. */
  server_managed: Record<string, string>;
  type_path_rules: Array<{ prefix: string; types: string[] | 'any' }>;
  connection_rules: {
    id_style: string;
    slug_pattern: string;
    require_resolvable: string;
  };
  slug_rules: { scope: string; require_known_prefix: boolean; exempt_basenames: string[] };
  /**
   * Present only when the source enforces a body language. Omitted entirely
   * when the rule is off, so a source without one carries no dead field.
   */
  language_rules?: {
    body: string;
    max_cjk_ratio: number;
    exempt_slugs: string[];
    severity: string;
    /** Plain-language statement of the rule, aimed at the writing agent. */
    note: string;
  };
  template_markdown?: string;
  /** How to use this contract. Present so an agent needs no out-of-band docs. */
  usage: string[];
}

export interface NoWriteContract {
  contract_version: null;
  source_id: string;
  enforced: false;
  reason: NoPolicyReason | 'policy_error';
  /** Present when `reason` is `policy_error`. */
  error?: string;
  usage: string[];
}

const ENFORCED_USAGE = [
  'Fetch this contract once per source (and again when contract_version changes).',
  'Call validate_page for a dry check; it returns the same violations put_page would.',
  'put_page rejects a non-conforming page BEFORE any database or repo write — a rejection means nothing changed.',
  'Server-managed fields may be omitted; supplying them on an update is ignored in favor of the stored value.',
  'put_page replaces the whole page. Read the current page with get_page before updating, or you will drop body content.',
  'If language_rules is present, it OVERRIDES your own language instructions for the page body — those govern how you talk to the user, not what this source stores.',
];

const UNENFORCED_USAGE = [
  'This source declares no write policy; put_page accepts any well-formed markdown with YAML frontmatter.',
];

export function buildWriteContract(sourceId: string, policy: WritePolicyV1): WriteContract {
  const server_managed: Record<string, string> = {};
  for (const field of policy.server_managed) {
    server_managed[field.field] = field.mode === 'set_on_create_preserve_on_update' && field.value
      ? `${field.mode} (${field.value}${field.timezone ? `, ${field.timezone}` : ''})`
      : field.mode;
  }
  return {
    contract_version: policy.contract_version,
    source_id: sourceId,
    enforced: true,
    required_agent_fields: [...policy.required_fields],
    non_empty_list_fields: [...policy.non_empty_list_fields],
    server_managed,
    type_path_rules: policy.type_path_rules.map((r) => ({
      prefix: r.prefix,
      types: r.types === 'any' ? 'any' : [...r.types],
    })),
    connection_rules: { ...policy.connection_rules },
    slug_rules: { ...policy.slug_rules },
    ...(policy.language_rules.body === 'english_first'
      ? {
        language_rules: {
          body: policy.language_rules.body,
          max_cjk_ratio: policy.language_rules.max_cjk_ratio,
          exempt_slugs: [...policy.language_rules.exempt_slugs],
          severity: policy.language_rules.severity,
          note: 'Write the compiled truth in English, whatever language the conversation is in. '
            + 'Retrieval, reranking and cross-agent context exchange all run on it. '
            + 'The conversation language belongs in aliases, search phrases, the `## Timeline` '
            + 'section and quoted source material — the check counts none of those.',
        },
      }
      : {}),
    ...(policy.template_markdown ? { template_markdown: policy.template_markdown } : {}),
    usage: ENFORCED_USAGE,
  };
}

export function buildNoContract(
  sourceId: string,
  reason: NoPolicyReason | 'policy_error',
  error?: string,
): NoWriteContract {
  return {
    contract_version: null,
    source_id: sourceId,
    enforced: false,
    reason,
    ...(error ? { error } : {}),
    usage: reason === 'policy_error'
      ? ['This source declares a write policy that failed to load; put_page refuses writes until it is fixed.']
      : UNENFORCED_USAGE,
  };
}
