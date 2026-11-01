export type Migration = {
  id: string;
  sql: string;
};

export const migrations: Migration[] = [
  {
    id: '001_init',
    sql: `
      CREATE TABLE IF NOT EXISTS organisations (
        id uuid PRIMARY KEY,
        name text NOT NULL,
        reporting_currency text NOT NULL DEFAULT 'USD',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS members (
        id uuid PRIMARY KEY,
        organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
        email text NOT NULL,
        display_name text NOT NULL,
        role text NOT NULL CHECK (role IN ('administrator', 'manager', 'member')),
        status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
        password_hash text,
        oidc_subject text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS members_email_org_uq
        ON members (organisation_id, lower(email));
      CREATE UNIQUE INDEX IF NOT EXISTS members_oidc_uq
        ON members (oidc_subject) WHERE oidc_subject IS NOT NULL;

      CREATE TABLE IF NOT EXISTS projects (
        id uuid PRIMARY KEY,
        organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
        plane_project_id text,
        name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS projects_plane_uq
        ON projects (organisation_id, plane_project_id)
        WHERE plane_project_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS rates (
        id uuid PRIMARY KEY,
        organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
        scope text NOT NULL CHECK (scope IN ('member', 'project', 'client')),
        member_id uuid REFERENCES members(id) ON DELETE CASCADE,
        project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
        client_id uuid,
        currency text NOT NULL,
        hourly_amount numeric(14, 4) NOT NULL CHECK (hourly_amount >= 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK (
          (scope = 'member' AND member_id IS NOT NULL AND project_id IS NULL AND client_id IS NULL)
          OR (scope = 'project' AND project_id IS NOT NULL AND member_id IS NULL AND client_id IS NULL)
          OR (scope = 'client' AND client_id IS NOT NULL AND member_id IS NULL AND project_id IS NULL)
        )
      );

      CREATE UNIQUE INDEX IF NOT EXISTS rates_member_uq
        ON rates (organisation_id, member_id) WHERE scope = 'member';
      CREATE UNIQUE INDEX IF NOT EXISTS rates_project_uq
        ON rates (organisation_id, project_id) WHERE scope = 'project';
      CREATE UNIQUE INDEX IF NOT EXISTS rates_client_uq
        ON rates (organisation_id, client_id) WHERE scope = 'client';

      CREATE TABLE IF NOT EXISTS budgets (
        id uuid PRIMARY KEY,
        organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
        project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        amount numeric(14, 2) NOT NULL CHECK (amount >= 0),
        currency text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (project_id)
      );

      CREATE TABLE IF NOT EXISTS time_entries (
        id uuid PRIMARY KEY,
        organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
        project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
        member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        work_item_id text,
        description text,
        source text NOT NULL CHECK (source IN ('timer', 'manual')),
        started_at timestamptz NOT NULL,
        ended_at timestamptz NOT NULL,
        duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
        billable_minutes integer NOT NULL CHECK (billable_minutes > 0),
        currency text,
        rate_applied numeric(14, 4),
        cost numeric(14, 4),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS time_entries_org_started_idx
        ON time_entries (organisation_id, started_at);

      CREATE TABLE IF NOT EXISTS audit_log (
        id uuid PRIMARY KEY,
        organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
        actor_member_id uuid REFERENCES members(id) ON DELETE SET NULL,
        action text NOT NULL,
        entity_type text NOT NULL,
        entity_id uuid,
        before_state jsonb,
        after_state jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS audit_log_org_created_idx
        ON audit_log (organisation_id, created_at DESC);
    `,
  },
  {
    id: '002_plane',
    sql: `
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS identifier text;
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS synced_at timestamptz;

      CREATE TABLE IF NOT EXISTS plane_connections (
        id uuid PRIMARY KEY,
        organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
        member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        base_url text NOT NULL,
        workspace_slug text NOT NULL,
        encrypted_token text NOT NULL,
        webhook_secret text,
        status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'error')),
        last_verified_at timestamptz,
        last_synced_at timestamptz,
        last_error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (member_id)
      );

      CREATE TABLE IF NOT EXISTS work_items (
        id uuid PRIMARY KEY,
        organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
        project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
        plane_work_item_id text NOT NULL,
        identifier text,
        name text NOT NULL,
        state_group text,
        is_open boolean NOT NULL DEFAULT true,
        plane_updated_at timestamptz,
        synced_at timestamptz NOT NULL DEFAULT now(),
        raw jsonb,
        UNIQUE (organisation_id, plane_work_item_id)
      );

      CREATE INDEX IF NOT EXISTS work_items_project_idx
        ON work_items (organisation_id, project_id, is_open);

      CREATE TABLE IF NOT EXISTS plane_sync_runs (
        id uuid PRIMARY KEY,
        organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
        connection_id uuid REFERENCES plane_connections(id) ON DELETE CASCADE,
        trigger text NOT NULL,
        status text NOT NULL CHECK (status IN ('ok', 'error')),
        projects_synced integer NOT NULL DEFAULT 0,
        work_items_synced integer NOT NULL DEFAULT 0,
        error text,
        started_at timestamptz NOT NULL DEFAULT now(),
        finished_at timestamptz
      );

      CREATE INDEX IF NOT EXISTS plane_sync_runs_connection_idx
        ON plane_sync_runs (connection_id, started_at DESC);
    `,
  },
  {
    id: '003_time_tracking',
    sql: `
      ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

      CREATE INDEX IF NOT EXISTS time_entries_member_started_idx
        ON time_entries (organisation_id, member_id, started_at DESC)
        WHERE deleted_at IS NULL;

      CREATE TABLE IF NOT EXISTS timers (
        member_id uuid PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
        organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
        project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
        work_item_id text,
        description text,
        started_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS time_entry_history (
        id uuid PRIMARY KEY,
        entry_id uuid NOT NULL,
        organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
        actor_member_id uuid REFERENCES members(id) ON DELETE SET NULL,
        action text NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
        before_state jsonb,
        after_state jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS time_entry_history_entry_idx
        ON time_entry_history (entry_id, created_at ASC);
    `,
  },
  {
    id: '004_costing',
    sql: `
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_id uuid;
    `,
  },
  {
    id: '005_project_dates',
    sql: `
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS start_date date;
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS target_date date;
    `,
  },
  {
    id: '006_fx',
    sql: `
      CREATE TABLE IF NOT EXISTS fx_rates (
        currency text NOT NULL,
        rate_date date NOT NULL,
        eur_rate numeric(18, 8) NOT NULL CHECK (eur_rate > 0),
        fetched_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (currency, rate_date)
      );
    `,
  },
  {
    id: '007_feedback',
    sql: `
      ALTER TABLE members ADD COLUMN IF NOT EXISTS feedback_opt_in boolean NOT NULL DEFAULT false;

      CREATE TABLE IF NOT EXISTS feedback_events (
        id uuid PRIMARY KEY,
        organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
        member_hash text NOT NULL,
        action text NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
        source text,
        before_state jsonb,
        after_state jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS feedback_events_org_created_idx
        ON feedback_events (organisation_id, created_at DESC);
    `,
  },
  {
    id: '008_budget_financials',
    sql: `
      ALTER TABLE budgets ADD COLUMN IF NOT EXISTS price numeric(14, 2)
        CHECK (price IS NULL OR price >= 0);
      ALTER TABLE budgets ADD COLUMN IF NOT EXISTS profit_target_percent numeric(7, 4)
        CHECK (
          profit_target_percent IS NULL
          OR (profit_target_percent >= 0 AND profit_target_percent <= 100)
        );
      ALTER TABLE budgets ADD COLUMN IF NOT EXISTS margin_target_amount numeric(14, 2)
        CHECK (margin_target_amount IS NULL OR margin_target_amount >= 0);
    `,
  },
  {
    id: '009_timer_pause',
    sql: `
      ALTER TABLE timers ADD COLUMN IF NOT EXISTS paused_at timestamptz;
      ALTER TABLE timers ADD COLUMN IF NOT EXISTS paused_seconds double precision
        NOT NULL DEFAULT 0 CHECK (paused_seconds >= 0);
      ALTER TABLE timers ADD COLUMN IF NOT EXISTS state text
        GENERATED ALWAYS AS (CASE WHEN paused_at IS NULL THEN 'running' ELSE 'paused' END) STORED;
    `,
  },
  {
    id: '010_expenses',
    sql: `
      CREATE TABLE IF NOT EXISTS expenses (
        id uuid PRIMARY KEY,
        organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
        project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        work_item_id text,
        expense_date date NOT NULL,
        amount numeric(14, 2) NOT NULL CHECK (amount > 0),
        currency text NOT NULL,
        category text NOT NULL
          CHECK (category IN ('licences', 'travel', 'hardware', 'subcontractors', 'other')),
        note text,
        reporting_currency text,
        amount_reporting numeric(14, 4),
        fx_rate numeric(18, 8),
        fx_date date,
        created_by uuid REFERENCES members(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );

      CREATE INDEX IF NOT EXISTS expenses_project_idx
        ON expenses (organisation_id, project_id, expense_date DESC)
        WHERE deleted_at IS NULL;
    `,
  },
  {
    id: '011_rate_dates',
    sql: `
      ALTER TABLE organisations ADD COLUMN IF NOT EXISTS default_hourly_rate
        numeric(14, 4) NOT NULL DEFAULT 200 CHECK (default_hourly_rate >= 0);

      DELETE FROM rates WHERE scope = 'client';

      ALTER TABLE rates ADD COLUMN IF NOT EXISTS from_date date;
      UPDATE rates SET from_date = (created_at AT TIME ZONE 'UTC')::date
       WHERE from_date IS NULL;
      ALTER TABLE rates ALTER COLUMN from_date SET NOT NULL;

      DROP INDEX IF EXISTS rates_member_uq;
      DROP INDEX IF EXISTS rates_project_uq;
      DROP INDEX IF EXISTS rates_client_uq;

      ALTER TABLE rates DROP CONSTRAINT IF EXISTS rates_scope_check;
      ALTER TABLE rates DROP COLUMN IF EXISTS client_id;
      ALTER TABLE rates DROP CONSTRAINT IF EXISTS rates_check;

      -- Re-runnable: this change shipped once as '010_rate_dates' on a branch and
      -- databases that applied it already hold the new constraints and indexes.
      ALTER TABLE rates DROP CONSTRAINT IF EXISTS rates_target_check;
      ALTER TABLE rates ADD CONSTRAINT rates_scope_check
        CHECK (scope IN ('member', 'project', 'project_member'));
      ALTER TABLE rates ADD CONSTRAINT rates_target_check CHECK (
        (scope = 'member' AND member_id IS NOT NULL AND project_id IS NULL)
        OR (scope = 'project' AND project_id IS NOT NULL AND member_id IS NULL)
        OR (scope = 'project_member' AND member_id IS NOT NULL AND project_id IS NOT NULL)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS rates_member_date_uq
        ON rates (organisation_id, member_id, from_date) WHERE scope = 'member';
      CREATE UNIQUE INDEX IF NOT EXISTS rates_project_date_uq
        ON rates (organisation_id, project_id, from_date) WHERE scope = 'project';
      CREATE UNIQUE INDEX IF NOT EXISTS rates_project_member_date_uq
        ON rates (organisation_id, member_id, project_id, from_date)
        WHERE scope = 'project_member';
    `,
  },
  {
    id: '012_workspace_access',
    sql: `
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS workspace_slug text;

      -- Existing projects belong to the workspace of their organisation's
      -- connection(s); every sync keeps the value current afterwards.
      UPDATE projects p
         SET workspace_slug = (
               SELECT c.workspace_slug FROM plane_connections c
                WHERE c.organisation_id = p.organisation_id
                ORDER BY c.created_at ASC
                LIMIT 1
             )
       WHERE p.plane_project_id IS NOT NULL AND p.workspace_slug IS NULL;

      -- A row says a member has (status 'member') or once had (status 'former')
      -- Plane membership of a project, as seen with the member's own token.
      -- Former rows keep historic data readable; only 'member' rows allow new entries.
      CREATE TABLE IF NOT EXISTS project_access (
        member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
        status text NOT NULL CHECK (status IN ('member', 'former')),
        verified_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (member_id, project_id)
      );

      CREATE INDEX IF NOT EXISTS project_access_project_idx
        ON project_access (project_id);

      -- Permission-change fingerprint: sha-256 over the sorted set of Plane
      -- projects the member belongs to, and when it was last checked live.
      ALTER TABLE plane_connections ADD COLUMN IF NOT EXISTS access_hash text;
      ALTER TABLE plane_connections ADD COLUMN IF NOT EXISTS access_checked_at timestamptz;

      -- Existing time keeps its author's read access as history.
      INSERT INTO project_access (member_id, project_id, organisation_id, status)
      SELECT DISTINCT e.member_id, e.project_id, e.organisation_id, 'former'
        FROM time_entries e
       WHERE e.project_id IS NOT NULL
      ON CONFLICT (member_id, project_id) DO NOTHING;
    `,
  },
  {
    id: '013_connection_workspaces',
    sql: `
      -- A connection (base URL + the member's account token) now reads a list of
      -- Plane workspaces. Plane has no token-authenticated endpoint that lists
      -- them, so the member names the slugs and each one is verified on its own.
      CREATE TABLE IF NOT EXISTS plane_connection_workspaces (
        id uuid PRIMARY KEY,
        connection_id uuid NOT NULL REFERENCES plane_connections(id) ON DELETE CASCADE,
        organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
        slug text NOT NULL,
        status text NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'verified', 'failed')),
        error_category text CHECK (error_category IN ('unauthorised', 'not_found', 'network')),
        last_error text,
        project_count integer,
        webhook_secret text,
        last_verified_at timestamptz,
        last_synced_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS plane_connection_workspaces_slug_uq
        ON plane_connection_workspaces (connection_id, lower(slug));
      CREATE UNIQUE INDEX IF NOT EXISTS plane_connection_workspaces_webhook_uq
        ON plane_connection_workspaces (webhook_secret) WHERE webhook_secret IS NOT NULL;

      -- Existing single-workspace connections keep their token, base URL and
      -- webhook: the stored slug becomes the first list entry and the connection's
      -- webhook secret now belongs to that workspace.
      INSERT INTO plane_connection_workspaces
        (id, connection_id, organisation_id, slug, status, webhook_secret,
         last_verified_at, last_synced_at)
      SELECT gen_random_uuid(), c.id, c.organisation_id, c.workspace_slug,
             CASE WHEN c.status = 'error' THEN 'failed' ELSE 'verified' END,
             c.webhook_secret, c.last_verified_at, c.last_synced_at
        FROM plane_connections c
       WHERE c.workspace_slug IS NOT NULL AND btrim(c.workspace_slug) <> ''
      ON CONFLICT DO NOTHING;

      -- The single slug on the connection is obsolete; the column stays for
      -- rollback safety but is no longer written.
      ALTER TABLE plane_connections ALTER COLUMN workspace_slug DROP NOT NULL;

      -- Work items carry the workspace they came from, like projects do.
      ALTER TABLE work_items ADD COLUMN IF NOT EXISTS workspace_slug text;
      UPDATE work_items w
         SET workspace_slug = p.workspace_slug
        FROM projects p
       WHERE p.id = w.project_id AND w.workspace_slug IS NULL;

      CREATE INDEX IF NOT EXISTS projects_workspace_idx
        ON projects (organisation_id, workspace_slug);

      -- A sync where some workspaces succeeded and others failed.
      ALTER TABLE plane_sync_runs DROP CONSTRAINT IF EXISTS plane_sync_runs_status_check;
      ALTER TABLE plane_sync_runs ADD CONSTRAINT plane_sync_runs_status_check
        CHECK (status IN ('ok', 'partial', 'error'));
    `,
  },
];
