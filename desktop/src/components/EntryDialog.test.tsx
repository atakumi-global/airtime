import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ADMIN, timeEntry } from '../test/fixtures';
import { field, renderReady } from '../test/harness';
import { FakeServer, reject } from '../test/server';
import { EntryDialog } from './EntryDialog';

const ENTRY = timeEntry({ id: 'entry-9', description: 'Original note' });

async function setup() {
  const server = new FakeServer();
  server.on('GET /api/time-entries/entry-9/history', () => ({ history: [] }));
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const mounted = await renderReady(
    <EntryDialog entry={ENTRY} onClose={onClose} onSaved={onSaved} />,
  );
  return { server, onClose, onSaved, ...mounted };
}

describe('EntryDialog', () => {
  it('starts from the entry values', async () => {
    await setup();
    expect((field('Duration') as HTMLInputElement).value).toBe('1h 30m');
    expect((screen.getByPlaceholderText('What did you work on?') as HTMLInputElement).value).toBe(
      'Original note',
    );
  });

  it('saves the new duration and note, then reports the previous values (happy path)', async () => {
    const { server, onSaved } = await setup();
    server.on('PATCH /api/time-entries/entry-9', () => ({ entry: ENTRY }));

    fireEvent.change(field('Duration'), { target: { value: '2h' } });
    fireEvent.change(screen.getByPlaceholderText('What did you work on?'), {
      target: { value: 'New note' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const body = server.callsTo('PATCH /api/time-entries/entry-9')[0]?.body as {
      startedAt: string;
      endedAt: string;
      description: string;
    };
    expect(body.description).toBe('New note');
    expect(new Date(body.endedAt).getTime() - new Date(body.startedAt).getTime()).toBe(120 * 60000);
    expect(onSaved).toHaveBeenCalledWith({
      startedAt: ENTRY.started_at,
      endedAt: ENTRY.ended_at,
      description: 'Original note',
    });
  });

  it('sends a blank note as null', async () => {
    const { server, onSaved } = await setup();
    server.on('PATCH /api/time-entries/entry-9', () => ({ entry: ENTRY }));

    fireEvent.change(screen.getByPlaceholderText('What did you work on?'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const body = server.callsTo('PATCH /api/time-entries/entry-9')[0]!.body as { description: unknown };
    expect(body.description).toBeNull();
  });

  it('disables saving for an invalid duration', async () => {
    const { server } = await setup();

    fireEvent.change(field('Duration'), { target: { value: 'nope' } });

    expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true);
    expect(server.callsTo('PATCH /api/time-entries/entry-9')).toHaveLength(0);
  });

  it('shows the server message and keeps the dialog open when the save fails (error path)', async () => {
    const { server, onSaved } = await setup();
    server.on('PATCH /api/time-entries/entry-9', () => reject(403, 'entry is locked'));

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('entry is locked');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('asks for confirmation, then deletes the entry and closes (happy path)', async () => {
    const { server, onClose } = await setup();
    server.on('DELETE /api/time-entries/entry-9', () => undefined);

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('alertdialog', { name: 'Delete entry' })).toBeTruthy();
    expect(server.callsTo('DELETE /api/time-entries/entry-9')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Delete entry' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(server.callsTo('DELETE /api/time-entries/entry-9')).toHaveLength(1);
  });

  it('keeps the entry when the delete confirmation is cancelled', async () => {
    const { server, onClose } = await setup();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Delete entry' });
    fireEvent.click(confirm.querySelector('button.btn:not(.btn-danger)') as HTMLElement);

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(server.callsTo('DELETE /api/time-entries/entry-9')).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows the server message when the delete fails (error path)', async () => {
    const { server, onClose } = await setup();
    server.on('DELETE /api/time-entries/entry-9', () => reject(500, 'delete failed'));

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete entry' }));

    await waitFor(() => expect(screen.getAllByRole('alert').some((node) => node.textContent === 'delete failed')).toBe(true));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows the change history on demand', async () => {
    const server = new FakeServer();
    server.on('GET /api/time-entries/entry-9/history', () => ({
      history: [
        {
          id: 'h1',
          entry_id: 'entry-9',
          actor_member_id: ADMIN.id,
          action: 'created',
          before_state: null,
          after_state: {},
          created_at: '2026-09-02T10:30:00.000Z',
        },
        {
          id: 'h2',
          entry_id: 'entry-9',
          actor_member_id: 'someone-else-1234',
          action: 'updated',
          before_state: {},
          after_state: {},
          created_at: '2026-09-03T10:30:00.000Z',
        },
      ],
    }));
    await renderReady(<EntryDialog entry={ENTRY} onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'History' }));

    await waitFor(() => expect(screen.getByText('Entry created')).toBeTruthy());
    expect(screen.getByText('Entry updated')).toBeTruthy();
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getByText('Member someone-')).toBeTruthy();
  });

  it('says so when the history cannot be loaded', async () => {
    const server = new FakeServer();
    server.on('GET /api/time-entries/entry-9/history', () => reject(500, 'history unavailable'));
    await renderReady(<EntryDialog entry={ENTRY} onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'History' }));

    expect(await screen.findByText('history unavailable')).toBeTruthy();
  });

  it('saves with Ctrl+Enter', async () => {
    const { server, onSaved } = await setup();
    server.on('PATCH /api/time-entries/entry-9', () => ({ entry: ENTRY }));

    fireEvent.keyDown(field('Duration'), { key: 'Enter', ctrlKey: true });

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(server.callsTo('PATCH /api/time-entries/entry-9')).toHaveLength(1);
  });

  it('Escape closes the delete confirmation first, then the dialog', async () => {
    const { onClose } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Delete entry' });

    fireEvent.keyDown(confirm, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(field('Duration'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+Enter inside the delete confirmation does not save the entry', async () => {
    const { server } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Delete entry' });

    fireEvent.keyDown(confirm, { key: 'Enter', ctrlKey: true });

    expect(server.callsTo('PATCH /api/time-entries/entry-9')).toHaveLength(0);
  });
});
