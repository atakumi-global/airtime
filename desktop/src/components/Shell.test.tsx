import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ADMIN, MANAGER, PLAIN_MEMBER, queuedEntry, runningTimer } from '../test/fixtures';
import { mountApp, renderReady, seedSession } from '../test/harness';
import { FakeServer, unreachable } from '../test/server';
import { Shell, type View } from './Shell';

async function setup(member = ADMIN, options: { view?: View } = {}) {
  const server = new FakeServer();
  server.on('GET /api/me', () => ({ member }));
  const onNavigate = vi.fn();
  const onBackfill = vi.fn();
  const mounted = await renderReady(
    <Shell view={options.view ?? 'time'} onNavigate={onNavigate} onBackfill={onBackfill}>
      <p>page body</p>
    </Shell>,
    { cache: { member } },
  );
  return { server, onNavigate, onBackfill, ...mounted };
}

const nav = (name: string) => screen.queryByRole('button', { name });

describe('Shell', () => {
  it('shows every destination to an administrator', async () => {
    await setup(ADMIN);
    for (const name of ['My time', 'Back-fill', 'Reports', 'Projects', 'Budgets', 'Admin', 'Settings']) {
      expect(nav(name), name).toBeTruthy();
    }
  });

  it('hides Admin from a manager but keeps Reports and Budgets', async () => {
    await setup(MANAGER);
    expect(nav('Admin')).toBeNull();
    expect(nav('Reports')).toBeTruthy();
    expect(nav('Budgets')).toBeTruthy();
  });

  it('hides Reports, Budgets and Admin from a member', async () => {
    await setup(PLAIN_MEMBER);
    expect(nav('Reports')).toBeNull();
    expect(nav('Budgets')).toBeNull();
    expect(nav('Admin')).toBeNull();
    expect(nav('My time')).toBeTruthy();
    expect(nav('Projects')).toBeTruthy();
    expect(nav('Settings')).toBeTruthy();
  });

  it('marks the current view and navigates on click', async () => {
    const { onNavigate } = await setup(ADMIN, { view: 'projects' });
    expect(nav('Projects')!.getAttribute('aria-current')).toBe('page');
    expect(nav('My time')!.getAttribute('aria-current')).toBeNull();

    fireEvent.click(nav('Settings')!);
    fireEvent.click(nav('Budgets')!);

    expect(onNavigate).toHaveBeenNthCalledWith(1, 'settings');
    expect(onNavigate).toHaveBeenNthCalledWith(2, 'rates');
  });

  it('opens the back-fill dialog from the sidebar', async () => {
    const { onBackfill } = await setup();
    fireEvent.click(nav('Back-fill')!);
    expect(onBackfill).toHaveBeenCalledTimes(1);
  });

  it('shows the organisation, the member initials and the page body', async () => {
    await setup(ADMIN);
    expect(screen.getByText('Example Org')).toBeTruthy();
    expect(screen.getByTitle('Ada Admin').textContent).toBe('AA');
    expect(screen.getByText('page body')).toBeTruthy();
    expect(screen.queryByText('Offline', { selector: '.badge' })).toBeNull();
  });

  it('refreshes from the server on request', async () => {
    const { server } = await setup();
    const before = server.callsTo('GET /api/me').length;

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(server.callsTo('GET /api/me').length).toBe(before + 1));
  });

  it('shows the offline badge and a dismissable notice when the refresh cannot reach the server', async () => {
    const { server } = await setup();
    server.on('GET /api/me', unreachable);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    const banner = await screen.findByRole('status');
    expect(banner.textContent).toContain('Offline. Showing locally cached data.');
    expect(screen.getAllByText('Offline').length).toBeGreaterThan(0);

    fireEvent.click(within(banner).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Offline. Showing locally cached data.')).toBeNull();
  });

  it('shows how many entries wait in the offline queue', async () => {
    new FakeServer().on('POST /api/time-entries', unreachable);
    // Boot never finishes loading while the queue cannot be sent, so mount directly.
    seedSession({ cache: { queue: [queuedEntry('a'), queuedEntry('b')] } });
    mountApp(
      <Shell view="time" onNavigate={vi.fn()} onBackfill={vi.fn()}>
        <p>page body</p>
      </Shell>,
    );

    expect(await screen.findByText('2 queued')).toBeTruthy();
  });
});

describe('Shell shortcuts', () => {
  const key = (name: string, mods: { ctrlKey?: boolean; altKey?: boolean } = {}) =>
    act(async () => {
      fireEvent.keyDown(window, { key: name, ...mods });
    });

  it('Ctrl+Alt+B opens back-fill and Ctrl+Alt+S opens the timesheet', async () => {
    const { onBackfill, onNavigate } = await setup(ADMIN, { view: 'projects' });

    await key('b', { ctrlKey: true, altKey: true });
    expect(onBackfill).toHaveBeenCalledTimes(1);

    await key('s', { ctrlKey: true, altKey: true });
    expect(onNavigate).toHaveBeenCalledWith('time');
  });

  it('ignores the keys without their modifiers and while a dialog is open', async () => {
    const { onBackfill } = await setup();

    await key('b');
    await key('b', { ctrlKey: true });
    expect(onBackfill).not.toHaveBeenCalled();

    const dialog = document.createElement('div');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);
    try {
      await key('b', { ctrlKey: true, altKey: true });
      expect(onBackfill).not.toHaveBeenCalled();
    } finally {
      dialog.remove();
    }
  });

  it('lists the shortcut on the back-fill and timesheet buttons with a spoken description', async () => {
    await setup();
    const backfill = nav('Back-fill')!;
    expect(backfill.getAttribute('aria-keyshortcuts')).toBe('Control+Alt+B');
    expect(document.getElementById(backfill.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Shortcut: Back-fill time, Control Alt B',
    );
    expect(nav('My time')!.getAttribute('aria-keyshortcuts')).toBe('Control+Alt+S');
    expect(nav('Search work items')!.getAttribute('aria-keyshortcuts')).toBe('Control+K');
  });

  it('opens the shortcut help from the nav and lists every shortcut with its keys', async () => {
    await setup();

    fireEvent.click(nav('Keyboard shortcuts')!);

    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    const rows = within(dialog).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      'Start or stop the timerAnywhere in AirtimeCtrlAltTControl Alt T',
      'Back-fill timeAnywhere in AirtimeCtrlAltBControl Alt B',
      'Search work itemsAnywhere in AirtimeCtrlKControl K',
      'Open timesheetAnywhere in AirtimeCtrlAltSControl Alt S',
      'Show tray menuAnywhere in AirtimeCtrlAltMControl Alt M',
      'Save entry from a dialogInside a dialog and the bulk entry tableCtrlEnterControl Enter',
    ]);
    expect(within(dialog).getByText(/Start or stop the timer, Control Alt T/)).toBeTruthy();
  });

  it('closes the help with Escape and returns focus to the button that opened it', async () => {
    await setup();
    const opener = nav('Keyboard shortcuts')!;
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });

    fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('the help links to Settings', async () => {
    const { onNavigate } = await setup();
    fireEvent.click(nav('Keyboard shortcuts')!);

    fireEvent.click(screen.getByRole('button', { name: 'Change shortcuts in Settings' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onNavigate).toHaveBeenCalledWith('settings');
  });

  it('keeps Tab inside the dialog', async () => {
    await setup();
    fireEvent.click(nav('Keyboard shortcuts')!);
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    const buttons = within(dialog).getAllByRole('button');
    const last = buttons[buttons.length - 1]!;
    last.focus();

    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(buttons[0]);

    fireEvent.keyDown(buttons[0]!, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  describe('work item search (Ctrl+K)', () => {
    it('opens, filters, moves with the arrow keys and starts the timer on Enter', async () => {
      const { server } = await setup();
      server.on('POST /api/timer/start', () => ({ timer: runningTimer() }));

      await key('k', { ctrlKey: true });
      const box = screen.getByRole('combobox', { name: 'Search work items' });
      expect(document.activeElement).toBe(box);
      expect(screen.getAllByRole('option')).toHaveLength(2);

      fireEvent.change(box, { target: { value: 'web' } });
      expect(screen.getAllByRole('option')).toHaveLength(2);
      fireEvent.keyDown(box, { key: 'ArrowDown' });
      const selected = screen.getAllByRole('option').find((o) => o.getAttribute('aria-selected') === 'true');
      expect(selected?.textContent).toContain('WEB-2');
      expect(box.getAttribute('aria-activedescendant')).toBe(selected?.id);

      fireEvent.keyDown(box, { key: 'Enter' });

      await waitFor(() => expect(server.callsTo('POST /api/timer/start')).toHaveLength(1));
      expect(server.callsTo('POST /api/timer/start')[0]?.body).toEqual({
        workItemId: 'plane-wi-2',
        description: null,
      });
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('wraps around, jumps with Home and End, and starts on click', async () => {
      const { server } = await setup();
      server.on('POST /api/timer/start', () => ({ timer: runningTimer() }));
      await key('k', { ctrlKey: true });
      const box = screen.getByRole('combobox');
      const selectedText = () =>
        screen.getAllByRole('option').find((o) => o.getAttribute('aria-selected') === 'true')?.textContent;

      fireEvent.keyDown(box, { key: 'ArrowUp' });
      expect(selectedText()).toContain('WEB-2');
      fireEvent.keyDown(box, { key: 'Home' });
      expect(selectedText()).toContain('WEB-1');
      fireEvent.keyDown(box, { key: 'End' });
      expect(selectedText()).toContain('WEB-2');

      fireEvent.click(screen.getAllByRole('option')[0]!);
      await waitFor(() => expect(server.callsTo('POST /api/timer/start')).toHaveLength(1));
    });

    it('says when nothing matches and does nothing on Enter', async () => {
      const { server } = await setup();
      await key('k', { ctrlKey: true });
      const box = screen.getByRole('combobox');

      fireEvent.change(box, { target: { value: 'zzz' } });
      fireEvent.keyDown(box, { key: 'Enter' });

      expect(screen.queryAllByRole('option')).toHaveLength(0);
      expect(screen.getByText('No work items match.')).toBeTruthy();
      expect(screen.getByRole('dialog', { name: 'Search work items' })).toBeTruthy();
      expect(server.callsTo('POST /api/timer/start')).toHaveLength(0);
    });

    it('closes with Escape', async () => {
      await setup();
      await key('k', { ctrlKey: true });

      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });

      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  describe('tray menu (Ctrl+Alt+M)', () => {
    it('shows the idle tray menu and runs a choice through the same code as the tray', async () => {
      const { onBackfill } = await setup();

      await key('m', { ctrlKey: true, altKey: true });
      const dialog = screen.getByRole('dialog', { name: 'Tray menu' });
      expect(within(dialog).getByText('Idle')).toBeTruthy();
      expect(
        within(dialog)
          .getAllByRole('button')
          .map((b) => b.textContent),
      ).toEqual(['Close', 'Start last work item', 'Back-fill time', 'Timesheet', 'Settings']);

      fireEvent.click(within(dialog).getByRole('button', { name: 'Back-fill time' }));

      expect(onBackfill).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('offers pause and stop while a timer runs, and stops it', async () => {
      const server = new FakeServer();
      server.on('GET /api/timer', () => ({ timer: runningTimer() }));
      server.on('POST /api/timer/stop', () => ({ entry: {} }));
      await renderReady(
        <Shell view="time" onNavigate={vi.fn()} onBackfill={vi.fn()}>
          <p>body</p>
        </Shell>,
        { cache: { timer: runningTimer() } },
      );

      await key('m', { ctrlKey: true, altKey: true });
      const dialog = screen.getByRole('dialog', { name: 'Tray menu' });
      expect(within(dialog).getByRole('button', { name: 'Pause timer' })).toBeTruthy();

      fireEvent.click(within(dialog).getByRole('button', { name: 'Stop timer' }));

      await waitFor(() => expect(server.callsTo('POST /api/timer/stop')).toHaveLength(1));
    });
  });
});
