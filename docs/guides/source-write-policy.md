# Source write policy — a discoverable, enforced page contract

A brain repo usually has house rules its markdown must follow: required
frontmatter, which page types belong in which directory, how `connections`
entries are written. Those rules typically live in a repo lint or a pre-commit
hook — which means an agent writing through MCP cannot see them, and finds out
it broke them only when the repo refuses to commit hours later.

A **source write policy** moves that contract to where the agent can reach it:

- `get_write_contract` tells an agent exactly what to fill in.
- `validate_page` checks a payload without writing.
- `put_page` enforces the same rules **before** the DB write. A violation
  writes nothing — no page row, no repo write-through, no auto-link.

Opt-in per source. A source with no policy behaves exactly as gbrain always
has, and no source's rules leak into another's.

## Where the policy lives

In the source repo's own `gbrain.yml`, under `write_policy:`. It belongs to the
repo that will reject the commit, not to the brain that indexes it — so it is
version-controlled alongside the content it governs, and a `gbrain sources add`
of that repo carries the contract with it.

gbrain finds it via `sources.local_path`. Sources with no local path (pure DB
sources, mounted remote brains) have no policy.

## Not a schema pack

| | Schema pack | Write policy |
|---|---|---|
| Answers | which page **types** exist, and their path prefixes | what must be in the **frontmatter** before this repo accepts the page |
| Scope | brain-wide taxonomy, drives retrieval | one source's repo hygiene |
| Lives in | `~/.gbrain/schema-packs/` or built-in | the source repo's `gbrain.yml` |

They compose: the pack decides `concept` is a type; the policy decides that a
page under `concepts/` must declare one of a named set of types **and** carry
`title`, `tags`, and a `created` date.

## Full shape

```yaml
write_policy:
  version: 1
  enabled: true
  contract_version: "1"          # bump when you change rules; agents cache against it

  # Fields the AGENT must supply. The server never invents these.
  required_fields: [title, type, tags]
  # Of those (or any optional key), which must be non-empty lists.
  non_empty_list_fields: [tags]

  # Fields the SERVER owns.
  #   set_on_create_preserve_on_update — filled on create, stored value wins on update
  #   preserve_on_update              — never fabricated, stored value wins on update
  server_managed:
    created:
      mode: set_on_create_preserve_on_update
      value: date                  # date → YYYY-MM-DD | datetime → ISO 8601
      timezone: Asia/Taipei

  # Directory prefix → allowed types. Longest prefix wins. `types: any` waives.
  type_path_rules:
    - prefix: concepts/
      types: [concept, pattern, principle]
    - prefix: people/
      types: [person]
    - prefix: inbox/
      types: any

  connection_rules:
    id_style: slug_only            # slug_only | any — reject `concepts/foo` in connections[].id
    slug_pattern: kebab            # kebab | any
    require_resolvable: warn       # error | warn | off

  slug_rules:
    # `all` (default) governs every write. `known_prefixes` governs only slugs
    # under a prefix above and IGNORES the rest — mirror this to a repo lint
    # that walks fixed knowledge directories and skips everything else.
    scope: known_prefixes
    # Never governed, at any prefix. Matches a lint that skips README.md.
    exempt_basenames: [readme]
    # The opposite of `scope: known_prefixes`: REFUSE out-of-prefix writes
    # instead of ignoring them. Declaring both is a policy error.
    require_known_prefix: false

  template_markdown: |
    ---
    title: Page Title
    type: concept
    tags: [topic]
    ---

    Compiled truth here.
```

### On `scope` — ignore vs refuse

These look similar and are opposites:

- `scope: known_prefixes` — a slug outside every prefix is **not this policy's
  business**. It passes through unvalidated and byte-identical.
- `require_known_prefix: true` — a slug outside every prefix is **refused**.

Pick `known_prefixes` when a repo lint already defines the governed
directories and ignores the rest; pick `require_known_prefix` when writes
outside them are genuinely a mistake. Auditing a real brain before enabling
made the difference concrete: `require_known_prefix` would have rejected 17% of
its pages on rewrite (build notes, eval corpora, tool notes, directory
READMEs — none of which the repo lint ever looked at), versus 3.3% under
`known_prefixes`, all of which the lint also rejects.

**Audit before you enable.** Run the policy over the source's existing pages as
if each were being rewritten, and look at what would break. A policy that
rejects pages your own maintenance jobs rewrite will stall them.

### On `require_resolvable`

Keep it at `warn` unless you have a reason not to. Resolvability is
order-sensitive: writing page A that references not-yet-written page B is
legitimate, and a single-page write gate cannot know B is coming. The repo lint
sees the whole tree at commit time and is the right place to make it fatal.
`error` is available when a source genuinely wants writes blocked on dangling
references.

## What an agent does

```
get_write_contract            # once per source, and again when contract_version changes
  → validate_page (optional)  # dry check, same validator
  → put_page                  # rejected payloads write nothing
```

A rejection looks like:

```json
{
  "error": "policy_violation",
  "written": false,
  "contract_version": "1",
  "violations": [
    {
      "code": "missing_required_field",
      "severity": "error",
      "field": "created",
      "message": "frontmatter is missing required field `created`",
      "fix": "add `created` to the YAML frontmatter before writing."
    }
  ]
}
```

`severity: "warning"` never blocks the write; it is reported on the successful
response under `policy.warnings`.

## Failure modes, on purpose

- **Malformed policy → fail closed.** A `write_policy:` block that will not
  parse makes `put_page` return `write_policy_unavailable` and write nothing.
  Degrading to "no rules" would green-light pages the repo will refuse, which is
  the failure this feature exists to remove.
- **No policy → legacy behavior.** Absent block, `enabled: false`, no
  `gbrain.yml`, or no `local_path`: unchanged gbrain.
- **`bypass_policy: true`** is honored only for trusted local CLI callers
  (`ctx.remote === false`). Remote/MCP callers passing it are ignored. It exists
  for operator repair of a pre-policy backlog, not for routine writes.
- **`put_page` is a full-content replace.** Server-managed preservation stops
  frontmatter loss; it cannot recover body text an agent omitted. Read with
  `get_page` before updating.
