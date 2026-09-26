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
];
