import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { runMigrations } from '../src/db/migrate.js';
import { migrations } from '../src/db/migrations.js';

// The dev preview database holds data written while migrations 010_rate_dates and
// 011_workspace_access (the ids these two changes had on their branches, before they
// were renumbered to 011 and 012 on dev) were applied. Upgrading it must keep every row.

function sqlOf(id: string): string {
  const migration = migrations.find((m) => m.id === id);
  assert.ok(migration, `migration ${id} exists`);
  return migration.sql;
}

async function withSchema(run: (pool: pg.Pool, schema: string) => Promise<void>): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url, 'TEST_DATABASE_URL must be set');
  const schema = `mig_${randomUUID().replace(/-/g, '')}`;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 2 });
  try {
    await run(pool, schema);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}

async function applyAs(pool: pg.Pool, appliedId: string, sql: string): Promise<void> {
  await pool.query(sql);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  await pool.query('INSERT INTO schema_migrations (id) VALUES ($1)', [appliedId]);
}

async function seedPreviewData(pool: pg.Pool): Promise<{ organisationId: string }> {
  const organisationId = randomUUID();
  const memberId = randomUUID();
  const otherMemberId = randomUUID();
  const projectId = randomUUID();
  await pool.query("INSERT INTO organisations (id, name) VALUES ($1, 'Org')", [organisationId]);
  for (const [id, email] of [
    [memberId, 'a@b.test'],
    [otherMemberId, 'c@d.test'],
  ]) {
    await pool.query(
      `INSERT INTO members (id, organisation_id, email, display_name, role)
       VALUES ($1, $2, $3, 'M', 'member')`,
      [id, organisationId, email],
    );
  }
  await pool.query(
    "INSERT INTO projects (id, organisation_id, plane_project_id, name) VALUES ($1, $2, 'p', 'P')",
    [projectId, organisationId],
  );
  const rate = (scope: string, member: string | null, project: string | null, from: string) =>
    pool.query(
      `INSERT INTO rates (id, organisation_id, scope, member_id, project_id, currency, hourly_amount, from_date)
       VALUES ($1, $2, $3, $4, $5, 'USD', 10, $6)`,
      [randomUUID(), organisationId, scope, member, project, from],
    );
  await rate('member', memberId, null, '2026-01-01');
  await rate('member', memberId, null, '2026-06-01');
  await rate('project', null, projectId, '2026-01-01');
  await rate('project_member', otherMemberId, projectId, '2026-01-01');
  await pool.query(
    `INSERT INTO time_entries (id, organisation_id, project_id, member_id, source, started_at, ended_at,
                               duration_minutes, billable_minutes)
     VALUES ($1, $2, $3, $4, 'manual', '2026-02-01T09:00:00Z', '2026-02-01T10:00:00Z', 60, 60)`,
    [randomUUID(), organisationId, projectId, memberId],
  );
  return { organisationId };
}

async function assertUpgraded(pool: pg.Pool, appliedNow: string[]): Promise<void> {
  assert.ok(appliedNow.includes('011_rate_dates'));
  assert.ok(appliedNow.includes('013_connection_workspaces'));

  const rates = await pool.query(
    `SELECT scope, to_char(from_date, 'YYYY-MM-DD') AS from_date FROM rates ORDER BY scope, from_date`,
  );
  assert.deepEqual(rates.rows, [
    { scope: 'member', from_date: '2026-01-01' },
    { scope: 'member', from_date: '2026-06-01' },
    { scope: 'project', from_date: '2026-01-01' },
    { scope: 'project_member', from_date: '2026-01-01' },
  ]);
  const entries = await pool.query('SELECT 1 FROM time_entries');
  assert.equal(entries.rowCount, 1);

  const constraints = await pool.query(
    `SELECT conname FROM pg_constraint
      WHERE conrelid = 'rates'::regclass AND conname IN ('rates_scope_check', 'rates_target_check')
      ORDER BY conname`,
  );
  assert.deepEqual(
    constraints.rows.map((row) => row.conname),
    ['rates_scope_check', 'rates_target_check'],
  );
  // The constraints still hold after the upgrade.
  await assert.rejects(
    pool.query(
      `INSERT INTO rates (id, organisation_id, scope, currency, hourly_amount, from_date)
       SELECT $1, id, 'member', 'USD', 1, '2026-01-01' FROM organisations`,
      [randomUUID()],
    ),
  );

  const recorded = await pool.query<{ id: string }>('SELECT id FROM schema_migrations');
  const ids = new Set(recorded.rows.map((row) => row.id));
  for (const migration of migrations) {
    assert.ok(ids.has(migration.id), `${migration.id} recorded`);
  }
}

test('a database that already ran the rate-dates change under its branch id upgrades with its data', async () => {
  await withSchema(async (pool) => {
    for (const migration of migrations.slice(0, 10)) {
      await applyAs(pool, migration.id, migration.sql);
    }
    await applyAs(pool, '010_rate_dates', sqlOf('011_rate_dates'));
    await seedPreviewData(pool);

    const appliedNow = await runMigrations(pool);
    await assertUpgraded(pool, appliedNow);
    assert.deepEqual(await runMigrations(pool), []);
  });
});

test('a database that also ran the workspace-access change under its branch id upgrades with its data', async () => {
  await withSchema(async (pool) => {
    for (const migration of migrations.slice(0, 10)) {
      await applyAs(pool, migration.id, migration.sql);
    }
    await applyAs(pool, '010_rate_dates', sqlOf('011_rate_dates'));
    await applyAs(pool, '011_workspace_access', sqlOf('012_workspace_access'));
    const { organisationId } = await seedPreviewData(pool);
    await pool.query(
      `INSERT INTO project_access (member_id, project_id, organisation_id, status)
       SELECT m.id, p.id, $1, 'member' FROM members m, projects p LIMIT 1`,
      [organisationId],
    );

    const appliedNow = await runMigrations(pool);
    await assertUpgraded(pool, appliedNow);
    const access = await pool.query('SELECT status FROM project_access');
    assert.deepEqual(access.rows, [{ status: 'member' }]);
  });
});

test('a database at the last good schema upgrades with its data', async () => {
  await withSchema(async (pool) => {
    const lastGood = migrations.findIndex((m) => m.id === '010_expenses');
    for (const migration of migrations.slice(0, lastGood + 1)) {
      await applyAs(pool, migration.id, migration.sql);
    }
    await pool.query("INSERT INTO organisations (id, name) VALUES ($1, 'Org')", [randomUUID()]);
    const appliedNow = await runMigrations(pool);
    assert.deepEqual(appliedNow, [
      '011_rate_dates',
      '012_workspace_access',
      '013_connection_workspaces',
    ]);
    const organisations = await pool.query('SELECT 1 FROM organisations');
    assert.equal(organisations.rowCount, 1);
  });
});
