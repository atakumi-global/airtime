import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, MANAGER, PLAIN_MEMBER } from '../test/fixtures';
import { field, renderReady } from '../test/harness';
import { FakeServer, reject } from '../test/server';
import { Admin } from './Admin';

const MEMBERS = [ADMIN, MANAGER, PLAIN_MEMBER];

async function setup(member = ADMIN) {
  const server = new FakeServer();
  server.on('GET /api/me', () => ({ member }));
  server.on('GET /api/members', () => ({ members: MEMBERS }));
  const mounted = await renderReady(<Admin />, { cache: { member } });
  return { server, ...mounted };
}

const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;

describe('Admin', () => {
  it('blocks a non-administrator', async () => {
    const { server } = await setup(MANAGER);
    expect(screen.getByText('Only administrators can open this screen.')).toBeTruthy();
    expect(server.callsTo('GET /api/members')).toHaveLength(0);
  });

  it('lists the members and protects the signed-in administrator', async () => {
    await setup();
    expect(await screen.findByText('Mia Manager')).toBeTruthy();
    const own = rowOf('Ada Admin');
    expect((within(own).getByRole('button', { name: 'Remove' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(own).getByRole('combobox') as HTMLSelectElement).disabled).toBe(true);
    const other = rowOf('Max Member');
    expect((within(other).getByRole('button', { name: 'Remove' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('adds a member and reloads the list (happy path)', async () => {
    const { server } = await setup();
    await screen.findByText('Mia Manager');
    server.on('POST /api/members', () => ({ member: PLAIN_MEMBER }));

    fireEvent.change(field('Display name'), { target: { value: 'Nia New' } });
    fireEvent.change(field('Email'), { target: { value: 'nia@example.test' } });
    fireEvent.change(field<HTMLSelectElement>('Role'), { target: { value: 'manager' } });
    fireEvent.change(field('Password'), { target: { value: 'pw-123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));

    expect(await screen.findByText('Member added.')).toBeTruthy();
    expect(server.callsTo('POST /api/members')[0]?.body).toEqual({
      email: 'nia@example.test',
      displayName: 'Nia New',
      role: 'manager',
      password: 'pw-123456',
    });
    expect(field('Display name').value).toBe('');
    expect(server.callsTo('GET /api/members').length).toBeGreaterThan(1);
  });

  it('leaves the password out when none is typed', async () => {
    const { server } = await setup();
    await screen.findByText('Mia Manager');
    server.on('POST /api/members', () => ({ member: PLAIN_MEMBER }));

    fireEvent.change(field('Display name'), { target: { value: 'Oidc Person' } });
    fireEvent.change(field('Email'), { target: { value: 'oidc@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));

    await screen.findByText('Member added.');
    expect(server.callsTo('POST /api/members')[0]?.body).not.toHaveProperty('password');
  });

  it('shows the server message when adding fails and keeps the form (error path)', async () => {
    const { server } = await setup();
    await screen.findByText('Mia Manager');
    server.on('POST /api/members', () => reject(409, 'email already in use'));

    fireEvent.change(field('Display name'), { target: { value: 'Dup' } });
    fireEvent.change(field('Email'), { target: { value: 'dup@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));

    expect(await screen.findByText('email already in use')).toBeTruthy();
    expect(field('Email').value).toBe('dup@example.test');
  });

  it('keeps Add member disabled until the name and email are filled in', async () => {
    await setup();
    await screen.findByText('Mia Manager');
    expect((screen.getByRole('button', { name: 'Add member' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('changes a role (happy path)', async () => {
    const { server } = await setup();
    await screen.findByText('Max Member');
    server.on(`PATCH /api/members/${PLAIN_MEMBER.id}/role`, () => ({ member: PLAIN_MEMBER }));

    fireEvent.change(within(rowOf('Max Member')).getByRole('combobox'), { target: { value: 'manager' } });

    await waitFor(() =>
      expect(server.callsTo(`PATCH /api/members/${PLAIN_MEMBER.id}/role`)[0]?.body).toEqual({
        role: 'manager',
      }),
    );
  });

  it('shows the server message when a role change fails (error path)', async () => {
    const { server } = await setup();
    await screen.findByText('Max Member');
    server.on(`PATCH /api/members/${PLAIN_MEMBER.id}/role`, () => reject(403, 'last administrator'));

    fireEvent.change(within(rowOf('Max Member')).getByRole('combobox'), { target: { value: 'administrator' } });

    expect(await screen.findByText('last administrator')).toBeTruthy();
  });

  it('removes a member (happy path)', async () => {
    const { server } = await setup();
    await screen.findByText('Max Member');
    server.on(`DELETE /api/members/${PLAIN_MEMBER.id}`, () => undefined);

    fireEvent.click(within(rowOf('Max Member')).getByRole('button', { name: 'Remove' }));

    expect(await screen.findByText('Member removed. Their historical entries are kept.')).toBeTruthy();
    expect(server.callsTo(`DELETE /api/members/${PLAIN_MEMBER.id}`)).toHaveLength(1);
  });

  it('shows the server message when removing fails (error path)', async () => {
    const { server } = await setup();
    await screen.findByText('Max Member');
    server.on(`DELETE /api/members/${PLAIN_MEMBER.id}`, () => reject(500, 'could not remove'));

    fireEvent.click(within(rowOf('Max Member')).getByRole('button', { name: 'Remove' }));

    expect(await screen.findByText('could not remove')).toBeTruthy();
  });

  it('shows the audit log with member names', async () => {
    const { server } = await setup();
    await screen.findByText('Mia Manager');
    server.on('GET /api/audit', () => ({
      entries: [
        {
          id: 'a1',
          actor_member_id: MANAGER.id,
          action: 'budget.set',
          entity_type: 'budget',
          entity_id: 'abcdef1234567890',
          before_state: null,
          after_state: null,
          created_at: '2026-09-02T10:30:00.000Z',
        },
      ],
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Audit log' }));

    expect(await screen.findByText('budget.set')).toBeTruthy();
    expect(screen.getByText('budget · abcdef12')).toBeTruthy();
    expect(server.callsTo('GET /api/audit')[0]?.query.get('limit')).toBe('200');
  });

  it('says when the audit log is empty', async () => {
    const { server } = await setup();
    await screen.findByText('Mia Manager');
    server.on('GET /api/audit', () => ({ entries: [] }));

    fireEvent.click(screen.getByRole('button', { name: 'Audit log' }));

    expect(await screen.findByText('No audit entries yet.')).toBeTruthy();
  });

  it('shows the server message when a tab cannot load (error path)', async () => {
    const { server } = await setup();
    await screen.findByText('Mia Manager');
    server.on('GET /api/audit', () => reject(500, 'audit unavailable'));

    fireEvent.click(screen.getByRole('button', { name: 'Audit log' }));

    expect(await screen.findByText('audit unavailable')).toBeTruthy();
  });

  describe('feedback tab', () => {
    beforeEach(() => {
      URL.createObjectURL = vi.fn(() => 'blob:feedback');
      URL.revokeObjectURL = vi.fn();
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('lists events and exports the anonymised dataset (happy path)', async () => {
      const { server } = await setup();
      await screen.findByText('Mia Manager');
      server.on('GET /api/feedback', () => ({
        events: [
          {
            id: 'f1',
            member_hash: 'abcdef0123456789',
            action: 'entry.updated',
            source: 'timer',
            before_state: null,
            after_state: null,
            created_at: '2026-09-02T10:30:00.000Z',
          },
        ],
      }));
      server.on('GET /api/feedback/export', () => ({ dataset: [{ a: 1 }, { a: 2 }] }));

      fireEvent.click(screen.getByRole('button', { name: 'Feedback' }));
      expect(await screen.findByText('entry.updated')).toBeTruthy();
      expect(screen.getByText('abcdef012345…')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));

      expect(await screen.findByText('Exported 2 anonymised events.')).toBeTruthy();
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    });

    it('shows the server message when the export fails (error path)', async () => {
      const { server } = await setup();
      await screen.findByText('Mia Manager');
      server.on('GET /api/feedback', () => ({ events: [] }));
      server.on('GET /api/feedback/export', () => reject(500, 'export failed upstream'));

      fireEvent.click(screen.getByRole('button', { name: 'Feedback' }));
      await screen.findByText('No feedback events yet.');
      fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));

      expect(await screen.findByText('export failed upstream')).toBeTruthy();
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    });
  });
});
