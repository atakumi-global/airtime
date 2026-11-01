import type { Db } from '../db/pool.js';
import { enterableProjectSql, readableOrUnassignedSql, type Viewer } from './access.js';

export type WorkItemRow = {
  id: string;
  organisation_id: string;
  project_id: string | null;
  plane_work_item_id: string;
  identifier: string | null;
  name: string;
  state_group: string | null;
  is_open: boolean;
  plane_updated_at: Date | null;
  synced_at: Date;
  project_name: string | null;
  project_identifier: string | null;
  /** False when the work item is history only for the viewer: no new time on it. */
  can_enter_time: boolean;
};

export async function listWorkItems(
  db: Db,
  organisationId: string,
  viewer: Viewer,
  options: { projectId?: string; includeClosed?: boolean } = {},
): Promise<WorkItemRow[]> {
  const params: unknown[] = [
    organisationId,
    options.projectId ?? null,
    options.includeClosed ?? false,
  ];
  const readable = readableOrUnassignedSql(viewer, 'w.project_id', params);
  const enterable = enterableProjectSql(viewer.memberId, 'w.project_id', params);
  return db.query<WorkItemRow>(
    `SELECT w.*, p.name AS project_name, p.identifier AS project_identifier,
            (w.project_id IS NULL OR ${enterable}) AS can_enter_time
       FROM work_items w
       LEFT JOIN projects p ON p.id = w.project_id
      WHERE w.organisation_id = $1
        AND ($2::uuid IS NULL OR w.project_id = $2)
        AND ($3::boolean OR w.is_open)
        AND ${readable}
      ORDER BY p.name ASC NULLS LAST, w.identifier ASC NULLS LAST, w.name ASC`,
    params,
  );
}
