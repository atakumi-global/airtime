import { randomUUID } from 'node:crypto';
import type { Db } from '../db/pool.js';

export type OrganisationRow = {
  id: string;
  name: string;
  reporting_currency: string;
  created_at: Date;
  updated_at: Date;
};

export async function getPrimaryOrganisation(
  db: Db,
): Promise<OrganisationRow | undefined> {
  const rows = await db.query<OrganisationRow>(
    'SELECT * FROM organisations ORDER BY created_at ASC LIMIT 1',
  );
  return rows[0];
}

export async function createOrganisation(
  db: Db,
  name: string,
  reportingCurrency = 'USD',
): Promise<OrganisationRow> {
  const id = randomUUID();
  const rows = await db.query<OrganisationRow>(
    `INSERT INTO organisations (id, name, reporting_currency)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [id, name, reportingCurrency],
  );
  return rows[0]!;
}
