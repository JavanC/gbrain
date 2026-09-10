// The single normalizer + validator shared by `validate_page` (preflight) and
// `put_page` (the gate). ONE implementation on purpose: a preflight that can
// pass while the real write fails is worse than no preflight at all.

import matter from 'gray-matter';
import { cjkRatio } from '../cjk.ts';
import { splitBody } from '../markdown.ts';
import { stripTakesFence } from '../takes-fence.ts';
import { stripFactsFence } from '../facts-fence.ts';
import type { ConnectionRules, WritePolicyV1 } from './policy-v1.ts';

export type ViolationSeverity = 'error' | 'warning';

export interface PolicyViolation {
  code:
    | 'frontmatter_unparseable'
    | 'missing_required_field'
    | 'empty_required_list'
    | 'type_not_allowed_in_path'
    | 'slug_outside_known_prefix'
    | 'connection_id_not_slug_only'
    | 'connection_id_not_kebab'
    | 'connection_unresolved'
    | 'server_managed_field_ignored'
    | 'body_language_not_english_first';
  severity: ViolationSeverity;
  field?: string;
  message: string;
  /** Copy-pasteable remediation, aimed at an agent rather than a human. */
  fix?: string;
}

export interface ValidatePageInput {
  policy: WritePolicyV1;
  slug: string;
  content: string;
  /**
   * Frontmatter of the page as it exists in the brain, or null for a create.
   * Drives server-managed preserve semantics.
   */
  existingFrontmatter: Record<string, unknown> | null;
  /** Injected for determinism in tests. */
  now?: Date;
  /** Resolve which of the given slugs exist in this source. Omitted → resolvability unchecked. */
  resolveKnownSlugs?: (ids: string[]) => Promise<Set<string>>;
}

export interface ValidatePageResult {
  valid: boolean;
  /** True when the page already exists in the brain (drives preserve semantics). */
  is_update: boolean;
  /** True when the policy declined to govern this slug (see `slug_rules.scope`). */
  out_of_scope: boolean;
  violations: PolicyViolation[];
  /** Frontmatter after server-managed normalization. */
  normalized_frontmatter: Record<string, unknown>;
  /** Markdown to actually write. Identical to the input when nothing was normalized. */
  normalized_content: string;
  /** True when normalization rewrote the payload. */
  normalized: boolean;
}

const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** `YYYY-MM-DD` in an IANA zone. en-CA formats as ISO-ordered date parts. */
function dateInZone(now: Date, timezone: string | undefined): string {
  if (!timezone) return now.toISOString().slice(0, 10);
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    // Unknown zone in the policy file: fall back to UTC rather than throwing
    // mid-write. The policy author sees the drift in `get_write_contract`.
    return now.toISOString().slice(0, 10);
  }
}

function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

interface ParsedConnection {
  id: string;
  index: number;
}

function extractConnections(frontmatter: Record<string, unknown>): ParsedConnection[] {
  const raw = frontmatter.connections;
  if (!Array.isArray(raw)) return [];
  const out: ParsedConnection[] = [];
  raw.forEach((entry, index) => {
    if (typeof entry === 'string') {
      const id = entry.trim();
      if (id) out.push({ id, index });
      return;
    }
    if (entry && typeof entry === 'object') {
      const id = (entry as Record<string, unknown>).id;
      if (typeof id === 'string' && id.trim()) out.push({ id: id.trim(), index });
    }
  });
  return out;
}

function matchTypePathRule(policy: WritePolicyV1, slug: string) {
  // Rules are pre-sorted longest-prefix-first by the parser.
  return policy.type_path_rules.find((rule) => slug.startsWith(rule.prefix)) ?? null;
}

/** Whether the policy declines to govern this slug at all. */
function isOutOfScope(policy: WritePolicyV1, slug: string): boolean {
  const basename = (slug.split('/').pop() ?? slug).toLowerCase();
  if (policy.slug_rules.exempt_basenames.includes(basename)) return true;
  if (policy.slug_rules.scope !== 'known_prefixes') return false;
  if (policy.type_path_rules.length === 0) return false;
  return matchTypePathRule(policy, slug) === null;
}

/**
 * Language-rule exemption. Matches a slug against the policy's `exempt_slugs`
 * globs: a leading star-slash means "any directory" (the shape the directory
 * signage pages `concepts/readme`, `people/readme`, … need), a trailing
 * slash-star means "this prefix and everything under it". Those pages are the
 * repo's own human-facing wayfinding, not promoted knowledge, so the
 * English-first rule was never aimed at them.
 */
function isLanguageExempt(policy: WritePolicyV1, slug: string): boolean {
  const lower = slug.toLowerCase();
  const basename = lower.split('/').pop() ?? lower;
  return policy.language_rules.exempt_slugs.some((pattern) => {
    if (pattern === lower) return true;
    if (pattern.startsWith('*/')) return basename === pattern.slice(2);
    if (pattern.endsWith('/*')) return lower.startsWith(pattern.slice(0, -1));
    return false;
  });
}

function checkConnections(
  connections: ParsedConnection[],
  rules: ConnectionRules,
  violations: PolicyViolation[],
): string[] {
  const resolvable: string[] = [];
  for (const conn of connections) {
    if (rules.id_style === 'slug_only' && conn.id.includes('/')) {
      const tail = conn.id.split('/').pop() ?? conn.id;
      violations.push({
        code: 'connection_id_not_slug_only',
        severity: 'error',
        field: `connections[${conn.index}].id`,
        message: `connection id "${conn.id}" must be a bare slug, not a path`,
        fix: `use \`id: ${tail}\`. Path-qualified references belong in the body as [[${conn.id}]].`,
      });
      continue;
    }
    if (rules.slug_pattern === 'kebab' && !KEBAB_RE.test(conn.id)) {
      violations.push({
        code: 'connection_id_not_kebab',
        severity: 'error',
        field: `connections[${conn.index}].id`,
        message: `connection id "${conn.id}" is not a kebab-case slug`,
        fix: 'lowercase alphanumerics separated by single hyphens, e.g. `agent-write-contract`.',
      });
      continue;
    }
    resolvable.push(conn.id);
  }
  return resolvable;
}

/**
 * Validate a `put_page` payload against a source's write policy and return the
 * markdown that should actually be written.
 *
 * Server-managed semantics:
 *   - create + `set_on_create_preserve_on_update` → server fills the field.
 *   - update + either mode → the STORED value wins. A caller that sends a
 *     different value gets a warning, not an error: `put_page` is a full-content
 *     replace, and silently letting a replace drop `created` is the bug this
 *     closes.
 */
export async function validatePageAgainstPolicy(input: ValidatePageInput): Promise<ValidatePageResult> {
  const { policy, slug, content, existingFrontmatter } = input;
  const now = input.now ?? new Date();
  const violations: PolicyViolation[] = [];
  const isUpdate = existingFrontmatter !== null;

  // Scope check FIRST. A policy that only governs certain directories must
  // leave everything else byte-identical and unjudged — including frontmatter
  // it cannot parse. Anything else would reject pages the source repo's own
  // lint never looks at.
  if (isOutOfScope(policy, slug)) {
    return {
      valid: true,
      is_update: isUpdate,
      out_of_scope: true,
      violations: [],
      normalized_frontmatter: {},
      normalized_content: content,
      normalized: false,
    };
  }

  let parsed: matter.GrayMatterFile<string> | null = null;
  let parseError: Error | null = null;
  try {
    parsed = matter(content);
  } catch (e) {
    parseError = e as Error;
  }

  if (parseError) {
    violations.push({
      code: 'frontmatter_unparseable',
      severity: 'error',
      message: `YAML frontmatter could not be parsed: ${parseError.message}`,
      fix: 'the page must open with a `---` fenced YAML block. Quote values containing `:` or `#`.',
    });
    return {
      valid: false,
      is_update: isUpdate,
      out_of_scope: false,
      violations,
      normalized_frontmatter: {},
      normalized_content: content,
      normalized: false,
    };
  }

  const frontmatter: Record<string, unknown> = { ...(parsed?.data ?? {}) };
  const body = parsed?.content ?? content;
  let normalized = false;

  // --- server-managed fields -------------------------------------------------
  for (const managed of policy.server_managed) {
    const existingValue = existingFrontmatter?.[managed.field];
    const suppliedValue = frontmatter[managed.field];

    if (isUpdate && !isEmptyValue(existingValue)) {
      if (!isEmptyValue(suppliedValue) && JSON.stringify(suppliedValue) !== JSON.stringify(existingValue)) {
        violations.push({
          code: 'server_managed_field_ignored',
          severity: 'warning',
          field: managed.field,
          message: `\`${managed.field}\` is server-managed; the stored value was kept and the supplied value ignored`,
        });
      }
      if (JSON.stringify(suppliedValue) !== JSON.stringify(existingValue)) {
        frontmatter[managed.field] = existingValue;
        normalized = true;
      }
      continue;
    }

    if (isEmptyValue(suppliedValue) && managed.mode === 'set_on_create_preserve_on_update') {
      frontmatter[managed.field] = managed.value === 'datetime'
        ? now.toISOString()
        : dateInZone(now, managed.timezone);
      normalized = true;
    }
  }

  // --- required fields -------------------------------------------------------
  const nonEmptyList = new Set(policy.non_empty_list_fields);
  for (const field of policy.required_fields) {
    const value = frontmatter[field];
    if (isEmptyValue(value)) {
      violations.push({
        code: 'missing_required_field',
        severity: 'error',
        field,
        message: `frontmatter is missing required field \`${field}\``,
        fix: `add \`${field}\` to the YAML frontmatter before writing.`,
      });
      continue;
    }
    if (nonEmptyList.has(field) && !Array.isArray(value)) {
      violations.push({
        code: 'empty_required_list',
        severity: 'error',
        field,
        message: `\`${field}\` must be a non-empty list`,
        fix: `write \`${field}:\` followed by \`- item\` lines.`,
      });
    }
  }
  for (const field of policy.non_empty_list_fields) {
    if (policy.required_fields.includes(field)) continue;
    const value = frontmatter[field];
    if (value !== undefined && (!Array.isArray(value) || value.length === 0)) {
      violations.push({
        code: 'empty_required_list',
        severity: 'error',
        field,
        message: `\`${field}\` must be a non-empty list when present`,
      });
    }
  }

  // --- directory / type agreement -------------------------------------------
  const rule = matchTypePathRule(policy, slug);
  if (!rule && policy.slug_rules.require_known_prefix && policy.type_path_rules.length > 0) {
    violations.push({
      code: 'slug_outside_known_prefix',
      severity: 'error',
      field: 'slug',
      message: `slug "${slug}" is not under any directory this source accepts`,
      fix: `use one of: ${policy.type_path_rules.map((r) => r.prefix).sort().join(', ')}`,
    });
  }
  if (rule && rule.types !== 'any') {
    const type = frontmatter.type;
    if (typeof type === 'string' && type.trim() && !rule.types.includes(type.trim())) {
      violations.push({
        code: 'type_not_allowed_in_path',
        severity: 'error',
        field: 'type',
        message: `type "${type}" is not allowed under ${rule.prefix}`,
        fix: `allowed types under ${rule.prefix}: ${rule.types.join(', ')}`,
      });
    }
  }

  // --- connections -----------------------------------------------------------
  const connections = extractConnections(frontmatter);
  const wellFormed = checkConnections(connections, policy.connection_rules, violations);
  if (
    policy.connection_rules.require_resolvable !== 'off'
    && wellFormed.length > 0
    && input.resolveKnownSlugs
  ) {
    let known = new Set<string>();
    try {
      known = await input.resolveKnownSlugs(wellFormed);
    } catch {
      // Resolution failure must not turn into a spurious rejection.
      known = new Set(wellFormed);
    }
    const severity: ViolationSeverity = policy.connection_rules.require_resolvable === 'error' ? 'error' : 'warning';
    for (const id of wellFormed) {
      if (known.has(id)) continue;
      violations.push({
        code: 'connection_unresolved',
        severity,
        field: 'connections',
        message: `connection id "${id}" does not resolve to a page in this source`,
        fix: `create the target page first, or drop the connection. The repo lint treats an unresolved id as fatal at commit time.`,
      });
    }
  }

  // --- body language ---------------------------------------------------------
  // Measured on the COMPILED TRUTH only. The convention this enforces
  // (javan-brain SCHEMA.md principle 2) puts the other language in aliases,
  // search phrases, the timeline and source quotes on purpose, so the timeline
  // half of the body and the takes/facts fences are stripped before counting —
  // a page with an English body and a Chinese timeline is CONFORMING, and a
  // naive whole-body count would refuse it.
  if (policy.language_rules.body === 'english_first' && !isLanguageExempt(policy, slug)) {
    const { compiled_truth } = splitBody(body);
    const measured = stripFactsFence(stripTakesFence(compiled_truth));
    const ratio = cjkRatio(measured);
    if (ratio >= policy.language_rules.max_cjk_ratio) {
      violations.push({
        code: 'body_language_not_english_first',
        severity: policy.language_rules.severity === 'error' ? 'error' : 'warning',
        field: 'body',
        message: `compiled truth is ${Math.round(ratio * 100)}% CJK (limit ${Math.round(policy.language_rules.max_cjk_ratio * 100)}%); this source keeps promoted pages English-first`,
        fix: 'Write the compiled truth in English — it is what retrieval, reranking and cross-agent context exchange run on. The original language belongs in aliases, search phrases, the `## Timeline` section, or quoted source material, none of which this check counts.',
      });
    }
  }

  const normalized_content = normalized ? matter.stringify(body, frontmatter) : content;

  return {
    valid: !violations.some((v) => v.severity === 'error'),
    is_update: isUpdate,
    out_of_scope: false,
    violations,
    normalized_frontmatter: frontmatter,
    normalized_content,
    normalized,
  };
}
