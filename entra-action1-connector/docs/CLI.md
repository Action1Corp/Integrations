# CLI Reference — Entra → Action1 Connector

This document describes all available CLI commands used to configure and manage the Entra → Action1 Connector.

The CLI is responsible for:
- Creating and validating `config.json`
- Configuring Action1 and Entra tenants
- Selecting Action1 organizations
- Inspecting configuration state
- Managing sync scope (targets)

---

## How to Run CLI Commands

All commands are executed via npm scripts.

**⚠️ Important:** When passing parameters to a command, you must use `--` before the flags.

**Pattern:**
```bash
npm run <command> -- <options>
```

**Example:**
```bash
npm run config:tenant:add -- --name "ACME" --tenant-id <id> ...
```

---

## Command Summary (All Commands)

### Configuration Lifecycle

| Command | Description |
|---------|-------------|
| `config:init` | Create empty `config.json` template |
| `config:show` | Display configuration in readable format |
| `config:show --resolve-orgs` | Resolve Action1 org names via API |
| `config:validate` | Strict validation (sync-ready check) |

### Action1 Configuration

| Command | Description |
|---------|-------------|
| `config:action1:set` | Configure Action1 API connection |

### Entra Tenant Management

| Command | Description |
|---------|-------------|
| `config:tenant:add` | Add Entra tenant |
| `config:tenant:list` | List configured tenants |
| `config:tenant:remove` | Remove tenant |

### Action1 Organization (Target Scope) Management

| Command | Description |
|---------|-------------|
| `config:org:select` | Interactive selection of Action1 orgs |
| `config:org:unselect` | Interactive removal of orgs |
| `config:org:add` | Add org ID(s) manually |
| `config:org:remove` | Remove org ID manually |

---

## Detailed Command Reference

### `config:init`

Create an empty configuration template.
```bash
npm run config:init -- --config ./config.json
```

**Options:**

| Option | Description |
|--------|-------------|
| `--config <path>` | Path to config file |
| `--force` | Overwrite existing file |

---

### `config:show`

Display configuration in a readable, user-friendly format.
```bash
npm run config:show -- --config ./config.json
```

**Resolve Action1 organization names:**
```bash
npm run config:show -- --config ./config.json --resolve-orgs
```

**Show verbose output (org IDs + details):**
```bash
npm run config:show -- --config ./config.json --resolve-orgs --verbose
```

**This command:**
- Does not require a fully configured tenant
- Works even if some tenants have no targets yet

---

### `config:validate`

Strictly validate configuration.
```bash
npm run config:validate -- --config ./config.json
```

**This command:**
- Requires all tenants to have target scopes
- Should pass before running sync

---

### `config:action1:set`

Configure Action1 API connection.
```bash
npm run config:action1:set -- \
  --config ./config.json \
  --base-url https://app.action1.com/api/3.0 \
  --client-id <action1-client-id> \
  --secret-ref action1:main
```

**Options:**

| Option | Description |
|--------|-------------|
| `--base-url` | Action1 API base URL |
| `--client-id` | Action1 API client ID |
| `--secret-ref` | Secret reference in OS vault |

---

### `config:tenant:add`

Add an Entra tenant.
```bash
npm run config:tenant:add -- \
  --config ./config.json \
  --name "ACME Main" \
  --tenant-id <entra-tenant-id> \
  --client-id <entra-app-id> \
  --secret-ref entra:acme-main
```

**Each tenant:**
- Represents one Entra directory
- Can contain multiple Action1 target scopes

---

### `config:tenant:list`

List configured tenants (safe output, masked client IDs).
```bash
npm run config:tenant:list -- --config ./config.json
```

---

### `config:tenant:remove`

Remove a tenant by name or tenantId.
```bash
npm run config:tenant:remove -- --config ./config.json --tenant "ACME Main"
```

---

### `config:org:select` (Interactive)

Interactively select Action1 organizations for a tenant.
```bash
npm run config:org:select -- \
  --config ./config.json \
  --tenant "ACME Main"
```

**Options:**

| Option | Description |
|--------|-------------|
| `--separate-target` | Create a new target scope |
| `--target-index <n>` | Add orgs to specific scope |

---

### `config:org:unselect` (Interactive)

Interactively remove organizations from a tenant.
```bash
npm run config:org:unselect -- \
  --config ./config.json \
  --tenant "ACME Main"
```

**Resolve org names before removal:**
```bash
npm run config:org:unselect -- \
  --config ./config.json \
  --tenant "ACME Main" \
  --resolve-orgs
```

---

### `config:org:add` (Manual)

Add organization IDs manually.
```bash
npm run config:org:add -- \
  --config ./config.json \
  --tenant "ACME Main" \
  --org-id <org-id>
```

**Add multiple:**
```bash
npm run config:org:add -- \
  --config ./config.json \
  --tenant "ACME Main" \
  --org-ids id1,id2,id3
```

---

### `config:org:remove` (Manual)

Remove an organization ID.
```bash
npm run config:org:remove -- \
  --config ./config.json \
  --tenant "ACME Main" \
  --org-id <org-id>
```

**Limit to a specific target scope:**
```bash
npm run config:org:remove -- \
  --config ./config.json \
  --tenant "ACME Main" \
  --org-id <id> \
  --target-index 2
```

---

## Target Scopes: Practical Examples

A **Target Scope** (also called "scope" in CLI output) is one element of `tenants[].targets[]`.

- Use `--separate-target` to create a new scope
- Use `--target-index N` to add/remove orgs within an existing scope

---

### Example A — Create a New Scope Using Interactive Select

Create a new scope for tenant "ACME Main" and put selected orgs there:
```bash
npm run config:org:select -- \
  --config ./config.json \
  --tenant "ACME Main" \
  --separate-target
```

**Result:**
- A new `targets[]` block is added
- Selected org IDs go into that new scope
- Default mappings are applied (from `DEFAULT_MAPPINGS`)

---

### Example B — Add Orgs to an Existing Scope

Add selected orgs to Scope #2 (existing) using interactive selection:
```bash
npm run config:org:select -- \
  --config ./config.json \
  --tenant "ACME Main" \
  --target-index 2
```

**Note:** If you omit both `--separate-target` and `--target-index`, the tool adds to Scope #1 (default behavior).
```bash
npm run config:org:select -- \
  --config ./config.json \
  --tenant "ACME Main"
```

---

### Example C — Create a New Scope Using Manual org-add

Create a new scope and add a single org ID:
```bash
npm run config:org:add -- \
  --config ./config.json \
  --tenant "ACME Main" \
  --org-id 7da22590-8db9-11f0-b7df-bd82ae1408bb \
  --separate-target
```

Create a new scope and add multiple org IDs:
```bash
npm run config:org:add -- \
  --config ./config.json \
  --tenant "ACME Main" \
  --org-ids id1,id2,id3 \
  --separate-target
```

---

### Example D — Remove Orgs from a Specific Scope (Interactive)

`org-unselect` lets you remove orgs, and you can limit it to a scope with `--target-index`.

Remove orgs only from Scope #2:
```bash
npm run config:org:unselect -- \
  --config ./config.json \
  --tenant "ACME Main" \
  --target-index 2
```

Resolve org names in the UI (recommended):
```bash
npm run config:org:unselect -- \
  --config ./config.json \
  --tenant "ACME Main" \
  --target-index 2 \
  --resolve-orgs
```

---

### Example E — Delete a Scope (What's Possible Today)

There is no dedicated CLI command to delete a scope block (`tenants[].targets[]`) directly.

**Recommended workflow:**

1. Remove all organizations from that scope:
```bash
npm run config:org:unselect -- \
  --config ./config.json \
  --tenant "ACME Main" \
  --target-index 2 \
  --resolve-orgs
```

2. Check config:
```bash
npm run config:show -- --config ./config.json
```

3. If Scope #2 is still present but empty, remove it manually from `config.json`:
   - Open `config.json`
   - Find the tenant → `targets`
   - Delete the empty object:
```json
{
  "organizationIds": [],
  "mappings": [...]
}
```

**Note:** Depending on implementation of `removeOrgFromTenant()` in `configManager.js`, empty scopes may be removed automatically. If not, manual cleanup is safe and expected.

---

### Example F — Remove a Single Org ID from a Scope (Manual)

Remove one org ID from anywhere in tenant:
```bash
npm run config:org:remove -- \
  --config ./config.json \
  --tenant "ACME Main" \
  --org-id 7da22590-8db9-11f0-b7df-bd82ae1408bb
```

Remove one org ID only from Scope #2:
```bash
npm run config:org:remove -- \
  --config ./config.json \
  --tenant "ACME Main" \
  --org-id 7da22590-8db9-11f0-b7df-bd82ae1408bb \
  --target-index 2
```

---

