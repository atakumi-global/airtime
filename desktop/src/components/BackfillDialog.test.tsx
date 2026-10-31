import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { field, renderReady } from '../test/harness';
import { FakeServer, reject, unreachable } from '../test/server';
import { BackfillDialog } from './BackfillDialog';

function setup(onClose = vi.fn()) {
  const server = new FakeServer();
  return { server, onClose };
}

describe('BackfillDialog', () => {
  it('saves a manual entry and closes (happy path)', async () => {
    const { server, onClose } = setup();
    await renderReady(<BackfillDialog onClose={onClose} />);

    fireEvent.change(field('Date'), { target: { value: '2026-09-01' } });
    fireEvent.change(field('Duration'), { target: { value: '2h' } });
    fireEvent.change(screen.getByPlaceholderText('What did you work on?'), {
      target: { value: 'Pairing' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save entry' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(server.callsTo('POST /api/time-entries')[0]?.body).toEqual({
      workItemId: 'plane-wi-1',
      date: '2026-09-01',
      durationMinutes: 120,
      description: 'Pairing',
    });
  });

  it('sends no work item when "No work item" is chosen', async () => {
    const { server, onClose } = setup();
    await renderReady(<BackfillDialog onClose={onClose} />);

    fireEvent.change(field<HTMLSelectElement>('Work item'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save entry' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const body = server.callsTo('POST /api/time-entries')[0]!.body as { workItemId: unknown };
    expect(body.workItemId).toBeNull();
  });

  it('blocks an invalid duration and shows why', async () => {
    const { server, onClose } = setup();
    await renderReady(<BackfillDialog onClose={onClose} />);

    fireEvent.change(field('Duration'), { target: { value: 'abc' } });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save entry' }) as HTMLButtonElement).disabled).toBe(true);
    expect(server.callsTo('POST /api/time-entries')).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows the server message and stays open when the save is rejected (error path)', async () => {
    const { server, onClose } = setup();
    await renderReady(<BackfillDialog onClose={onClose} />);
    server.on('POST /api/time-entries', () => reject(400, 'duration is too long'));

    fireEvent.click(screen.getByRole('button', { name: 'Save entry' }));

    expect(await screen.findByText('duration is too long')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Save entry' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('queues the entry and closes when the server is unreachable', async () => {
    const { server, onClose } = setup();
    const { app } = await renderReady(<BackfillDialog onClose={onClose} />);
    server.on('POST /api/time-entries', unreachable);

    fireEvent.click(screen.getByRole('button', { name: 'Save entry' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await waitFor(() => expect(app().queue).toHaveLength(1));
    expect(app().online).toBe(false);
  });

  it('closes from Cancel and Close without saving', async () => {
    const { server, onClose } = setup();
    await renderReady(<BackfillDialog onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(2);
    expect(server.callsTo('POST /api/time-entries')).toHaveLength(0);
  });
});
