import axe from 'axe-core';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Rate } from '../lib/types';
import { ADMIN, MANAGER, PLAIN_MEMBER } from './fixtures';
import { renderReady } from './harness';
import { FakeServer } from './server';
import { Rates } from '../screens/Rates';
import { Settings } from '../screens/Settings';

const RATES: Rate[] = [
  {
    id: 'rate-1',
    scope: 'project',
    member_id: null,
    project_id: 'project-1',
    from_date: '2026-01-01',
    currency: 'EUR',
    hourly_amount: '85.00',
  },
  {
    id: 'rate-2',
    scope: 'project_member',
    member_id: MANAGER.id,
    project_id: 'project-1',
    from_date: '2026-03-01',
    currency: 'NZD',
    hourly_amount: '120.00',
  },
];

async function violations(container: HTMLElement) {
  const result = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    // happy-dom has no layout or computed colours, so colour contrast cannot be measured here.
    rules: { 'color-contrast': { enabled: false } },
  });
  return result.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious',
  );
}

describe('accessibility (axe-core, WCAG 2.2 AA)', () => {
  it('has no critical or serious violations on the Rates screen', async () => {
    const server = new FakeServer();
    server.on('GET /api/me', () => ({ member: ADMIN }));
    server.on('GET /api/rates', () => ({ rates: RATES }));
    server.on('GET /api/members', () => ({ members: [ADMIN, MANAGER, PLAIN_MEMBER] }));
    const { container } = await mount(<Rates />);
    await waitFor(() => expect(screen.queryByText('Loading rates…')).toBeNull());
    expect(await violations(container)).toEqual([]);
  });

  it('has no critical or serious violations on the empty Rates screen', async () => {
    const server = new FakeServer();
    server.on('GET /api/me', () => ({ member: ADMIN }));
    server.on('GET /api/rates', () => ({ rates: [] }));
    server.on('GET /api/members', () => ({ members: [ADMIN] }));
    const { container } = await mount(<Rates />);
    await waitFor(() => expect(screen.queryByText('Loading rates…')).toBeNull());
    expect(await violations(container)).toEqual([]);
  });

  it('has no critical or serious violations on the Settings screen', async () => {
    const server = new FakeServer();
    server.on('GET /api/me', () => ({ member: ADMIN }));
    const { container } = await mount(<Settings />);
    expect(await violations(container)).toEqual([]);
  });
});

async function mount(ui: React.ReactNode): Promise<{ container: HTMLElement }> {
  await renderReady(ui, { cache: { member: ADMIN } });
  return { container: document.body };
}
