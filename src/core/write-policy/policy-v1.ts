// Source write-policy v1 — the machine-readable page contract a source repo
// declares for agent writes.
//
// WHY THIS EXISTS (and why it is NOT a schema pack):
//   - Schema pack answers "which page TYPES exist and which path prefixes they
//     live under". It is a retrieval/taxonomy concern, brain-wide.
//   - Write policy answers "what must be in the FRONTMATTER before this source's
//     repo will accept the page". It is a repo-hygiene concern, source-local:
//     required fields, server-managed fields, directory→type rules, connection
//     shape. A downstream repo lint (`lint-staged-brain-pages.js` in a brain
//     repo, a pre-commit hook, CI) is the final defense; this makes the same
//     rules DISCOVERABLE and ENFORCED before the DB write, so an agent never
//     produces a page that the repo will later refuse to commit.
//
// OPT-IN BY CONSTRUCTION. A source with no `write_policy:` block in its
// `gbrain.yml`, or with `enabled: false`, behaves exactly as gbrain always has.
// The javan-brain-style rules are NEVER hardcoded into gbrain's global op
// schema — every rule in this file comes from the source repo's own
// version-controlled policy document.

/** Where a server-managed field's value comes from and when it may change. */
export type ServerManagedMode =
  /** Server fills it on CREATE; on UPDATE the stored value wins. */
  | 'set_on_create_preserve_on_update'
  /** Server never fabricates it, but on UPDATE the stored value wins. */
  | 'preserve_on_update';

/** How a server-managed field's create-time value is computed. */
export type ServerManagedValue = 'date' | 'datetime';

export interface ServerManagedField {
  field: string;
  mode: ServerManagedMode;
  /** Only meaningful for `set_on_create_preserve_on_update`. */
  value?: ServerManagedValue;
  /** IANA zone used to compute `value`. Defaults to UTC. */
  timezone?: string;
}

/** Directory-prefix → allowed page types. `types: 'any'` waives the check. */
export interface TypePathRule {
  prefix: string;
  types: string[] | 'any';
}

export interface ConnectionRules {
  /** `slug_only` rejects `connections[].id` values containing a `/`. */
  id_style: 'slug_only' | 'any';
  /** `kebab` requires `^[a-z0-9]+(-[a-z0-9]+)*$`. */
  slug_pattern: 'kebab' | 'any';
  /**
   * Whether a connection id must already resolve to a page in this source.
   *
   * Defaults to `warn` and SHOULD stay there. Resolvability is
   * order-sensitive: writing page A that references not-yet-written page B is
   * legitimate, and a single-page write gate cannot know B is coming. The repo
   * lint (which sees the whole tree at commit time) is the right place to make
   * this fatal.
   */
  require_resolvable: 'error' | 'warn' | 'off';
}

export interface SlugRules {
  /**
   * Which slugs the policy applies to.
   *
   * `all` — every write to this source is validated.
   * `known_prefixes` — only slugs under a `type_path_rules` prefix are
   *   validated; anything else passes through UNCHECKED. This mirrors a repo
   *   lint that walks a fixed set of knowledge directories and ignores the
   *   rest (build scripts, eval corpora, tool notes). Without it, the gate
   *   would reject pages the repo never had an opinion about.
   */
  scope: 'all' | 'known_prefixes';
  /**
   * Require the slug to start with one of the `type_path_rules` prefixes.
   * Catches `put_page` writes that would land outside the repo's knowledge
   * directories. Mutually exclusive in spirit with `scope: known_prefixes`:
   * one REFUSES the out-of-prefix write, the other IGNORES it.
   */
  require_known_prefix: boolean;
  /**
   * Slug basenames the policy never applies to, lowercased (e.g. `readme` so
   * `concepts/README` is exempt the way a repo lint skips every README.md).
   */
  exempt_basenames: string[];
}

export interface WritePolicyV1 {
  version: 1;
  enabled: boolean;
  /** Bumped by the policy author; agents cache the contract against it. */
  contract_version: string;
  /** Frontmatter keys the AGENT must supply (server never invents these). */
  required_fields: string[];
  /** Non-empty-array frontmatter keys (subset semantics of required_fields). */
  non_empty_list_fields: string[];
  server_managed: ServerManagedField[];
  type_path_rules: TypePathRule[];
  connection_rules: ConnectionRules;
  slug_rules: SlugRules;
  /** Copy-pasteable skeleton returned by `get_write_contract`. */
  template_markdown?: string;
}

export class WritePolicyParseError extends Error {
  readonly path: string;
  constructor(message: string, path: string) {
    super(message);
    this.name = 'WritePolicyParseError';
    this.path = path;
  }
}

const DEFAULT_CONNECTION_RULES: ConnectionRules = {
  id_style: 'any',
  slug_pattern: 'any',
  require_resolvable: 'off',
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asStringArray(v: unknown, field: string, path: string): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new WritePolicyParseError(`write_policy.${field} must be a list`, path);
  return v.map((entry) => {
    if (typeof entry !== 'string') {
      throw new WritePolicyParseError(`write_policy.${field} entries must be strings`, path);
    }
    return entry.trim();
  }).filter(Boolean);
}

/**
 * Parse + validate the `write_policy:` block of a source's gbrain.yml.
 *
 * Fail-LOUD on a malformed policy: a policy that silently degrades to "no
 * rules" would hand the caller a green light for pages the repo will reject,
 * which is the exact failure mode this feature exists to remove. Callers that
 * want the lenient behavior (source has no policy at all) pass `undefined` and
 * get `null` back.
 */
export function parseWritePolicy(raw: unknown, path: string): WritePolicyV1 | null {
  if (raw === undefined || raw === null) return null;
  const doc = asRecord(raw);
  if (!doc) throw new WritePolicyParseError('write_policy must be a mapping', path);

  const version = doc.version ?? 1;
  if (version !== 1) {
    throw new WritePolicyParseError(`unsupported write_policy.version: ${String(version)} (this gbrain understands 1)`, path);
  }

  const enabled = doc.enabled === undefined ? true : doc.enabled === true;

  const serverManagedRaw = asRecord(doc.server_managed) ?? {};
  const server_managed: ServerManagedField[] = [];
  for (const [field, spec] of Object.entries(serverManagedRaw)) {
    const specRec = asRecord(spec);
    const mode = (specRec?.mode ?? spec) as unknown;
    if (mode !== 'set_on_create_preserve_on_update' && mode !== 'preserve_on_update') {
      throw new WritePolicyParseError(
        `write_policy.server_managed.${field}.mode must be set_on_create_preserve_on_update | preserve_on_update`,
        path,
      );
    }
    const value = specRec?.value as ServerManagedValue | undefined;
    if (value !== undefined && value !== 'date' && value !== 'datetime') {
      throw new WritePolicyParseError(`write_policy.server_managed.${field}.value must be date | datetime`, path);
    }
    if (mode === 'set_on_create_preserve_on_update' && value === undefined) {
      throw new WritePolicyParseError(
        `write_policy.server_managed.${field} uses set_on_create_preserve_on_update but declares no \`value\` (date | datetime)`,
        path,
      );
    }
    const timezone = specRec?.timezone;
    if (timezone !== undefined && typeof timezone !== 'string') {
      throw new WritePolicyParseError(`write_policy.server_managed.${field}.timezone must be a string`, path);
    }
    server_managed.push({
      field,
      mode,
      ...(value ? { value } : {}),
      ...(typeof timezone === 'string' ? { timezone } : {}),
    });
  }
  server_managed.sort((a, b) => a.field.localeCompare(b.field));

  const rulesRaw = doc.type_path_rules;
  const type_path_rules: TypePathRule[] = [];
  if (rulesRaw !== undefined && rulesRaw !== null) {
    if (!Array.isArray(rulesRaw)) throw new WritePolicyParseError('write_policy.type_path_rules must be a list', path);
    for (const entry of rulesRaw) {
      const rec = asRecord(entry);
      if (!rec || typeof rec.prefix !== 'string' || !rec.prefix.trim()) {
        throw new WritePolicyParseError('each write_policy.type_path_rules entry needs a `prefix` string', path);
      }
      const prefix = rec.prefix.trim();
      const types = rec.types === 'any' ? 'any' : asStringArray(rec.types, `type_path_rules[${prefix}].types`, path);
      if (types !== 'any' && types.length === 0) {
        throw new WritePolicyParseError(
          `write_policy.type_path_rules[${prefix}].types is empty — use \`types: any\` to waive the check`,
          path,
        );
      }
      type_path_rules.push({ prefix, types });
    }
  }
  // Longest prefix first so `meetings/transcripts/` beats `meetings/`.
  type_path_rules.sort((a, b) => b.prefix.length - a.prefix.length || a.prefix.localeCompare(b.prefix));

  const connRaw = asRecord(doc.connection_rules) ?? {};
  const id_style = (connRaw.id_style ?? DEFAULT_CONNECTION_RULES.id_style) as ConnectionRules['id_style'];
  if (id_style !== 'slug_only' && id_style !== 'any') {
    throw new WritePolicyParseError('write_policy.connection_rules.id_style must be slug_only | any', path);
  }
  const slug_pattern = (connRaw.slug_pattern ?? DEFAULT_CONNECTION_RULES.slug_pattern) as ConnectionRules['slug_pattern'];
  if (slug_pattern !== 'kebab' && slug_pattern !== 'any') {
    throw new WritePolicyParseError('write_policy.connection_rules.slug_pattern must be kebab | any', path);
  }
  const require_resolvable = (connRaw.require_resolvable
    ?? DEFAULT_CONNECTION_RULES.require_resolvable) as ConnectionRules['require_resolvable'];
  if (require_resolvable !== 'error' && require_resolvable !== 'warn' && require_resolvable !== 'off') {
    throw new WritePolicyParseError('write_policy.connection_rules.require_resolvable must be error | warn | off', path);
  }

  const slugRaw = asRecord(doc.slug_rules) ?? {};
  const scope = (slugRaw.scope ?? 'all') as SlugRules['scope'];
  if (scope !== 'all' && scope !== 'known_prefixes') {
    throw new WritePolicyParseError('write_policy.slug_rules.scope must be all | known_prefixes', path);
  }
  if (scope === 'known_prefixes' && slugRaw.require_known_prefix === true) {
    throw new WritePolicyParseError(
      'write_policy.slug_rules: scope=known_prefixes IGNORES out-of-prefix slugs while require_known_prefix REFUSES them — pick one',
      path,
    );
  }
  const slug_rules: SlugRules = {
    scope,
    require_known_prefix: slugRaw.require_known_prefix === true,
    exempt_basenames: asStringArray(slugRaw.exempt_basenames, 'slug_rules.exempt_basenames', path)
      .map((s) => s.toLowerCase()),
  };

  const template = doc.template_markdown;
  if (template !== undefined && typeof template !== 'string') {
    throw new WritePolicyParseError('write_policy.template_markdown must be a string', path);
  }

  const contractVersionRaw = doc.contract_version;
  if (contractVersionRaw !== undefined
    && typeof contractVersionRaw !== 'string'
    && typeof contractVersionRaw !== 'number') {
    throw new WritePolicyParseError('write_policy.contract_version must be a string or number', path);
  }

  return {
    version: 1,
    enabled,
    contract_version: contractVersionRaw === undefined ? '1' : String(contractVersionRaw),
    required_fields: asStringArray(doc.required_fields, 'required_fields', path),
    non_empty_list_fields: asStringArray(doc.non_empty_list_fields, 'non_empty_list_fields', path),
    server_managed,
    type_path_rules,
    connection_rules: { id_style, slug_pattern, require_resolvable },
    slug_rules,
    ...(typeof template === 'string' ? { template_markdown: template } : {}),
  };
}
