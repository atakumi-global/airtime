import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiClient, ApiError, NetworkError } from '../lib/api';
import {
  SESSION_KEY,
  deleteSecret,
  loadSecret,
  readCacheFile,
  saveSecret,
  writeCacheFile,
} from '../lib/native';
import { startOfWeek } from '../lib/format';
import type {
  CacheSnapshot,
  FxRates,
  Member,
  Organisation,
  PlaneConnection,
  Project,
  QueuedEntry,
  RunningTimer,
  TimeEntry,
  WorkItem,
} from '../lib/types';

const DEFAULT_BASE_URL = 'http://localhost:3000';
const SERVER_KEY = 'airtime.server-url';

export type ManualEntryInput = {
  workItemId: string | null;
  date: string;
  durationMinutes: number;
  description?: string | null;
};

type AppValue = {
  status: 'loading' | 'login' | 'ready';
  baseUrl: string;
  member: Member | null;
  organisation: Organisation | null;
  projects: Project[];
  workItems: WorkItem[];
  entries: TimeEntry[];
  timer: RunningTimer | null;
  planeConnection: PlaneConnection | null;
  fx: FxRates | null;
  timerPending: boolean;
  queue: QueuedEntry[];
  online: boolean;
  refreshing: boolean;
  error: string | null;
  notice: string | null;
  login: (baseUrl: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  startTimer: (workItemId: string | null) => Promise<void>;
  stopTimer: () => Promise<void>;
  addManualEntry: (input: ManualEntryInput) => Promise<void>;
  setFeedbackOptIn: (optIn: boolean) => Promise<void>;
  savePlaneConnection: (input: {
    baseUrl: string;
    workspaceSlug: string;
    token: string;
  }) => Promise<string>;
  syncPlane: () => Promise<string>;
  dismiss: () => void;
};

const AppContext = createContext<AppValue | null>(null);

function cachePayload(state: {
  member: Member | null;
  organisation: Organisation | null;
  projects: Project[];
  workItems: WorkItem[];
  entries: TimeEntry[];
  timer: RunningTimer | null;
  queue: QueuedEntry[];
}): CacheSnapshot {
  return { savedAt: new Date().toISOString(), ...state };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<'loading' | 'login' | 'ready'>('loading');
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [member, setMember] = useState<Member | null>(null);
  const [organisation, setOrganisation] = useState<Organisation | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [timer, setTimer] = useState<RunningTimer | null>(null);
  const [planeConnection, setPlaneConnection] = useState<PlaneConnection | null>(null);
  const [fx, setFx] = useState<FxRates | null>(null);
  const [timerPending, setTimerPending] = useState(false);
  const [queue, setQueue] = useState<QueuedEntry[]>([]);
  const [online, setOnline] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const clientRef = useRef<ApiClient>(new ApiClient({ baseUrl: DEFAULT_BASE_URL }));
  const tokenRef = useRef<string | null>(null);
  const timerSourceRef = useRef<'server' | 'local'>('server');
  const queueRef = useRef<QueuedEntry[]>([]);
  const stateRef = useRef({
    member,
    organisation,
    projects,
    workItems,
    entries,
    timer,
    queue,
  });

  useEffect(() => {
    stateRef.current = { member, organisation, projects, workItems, entries, timer, queue };
    queueRef.current = queue;
  }, [member, organisation, projects, workItems, entries, timer, queue]);

  const persist = useCallback(async () => {
    const snapshot = cachePayload({
      member: stateRef.current.member,
      organisation: stateRef.current.organisation,
      projects: stateRef.current.projects,
      workItems: stateRef.current.workItems,
      entries: stateRef.current.entries,
      timer: stateRef.current.timer,
      queue: stateRef.current.queue,
    });
    try {
      await writeCacheFile(JSON.stringify(snapshot));
    } catch {
      // cache is best effort
    }
  }, []);

  useEffect(() => {
    void persist();
  }, [member, organisation, projects, workItems, entries, timer, queue, persist]);

  const weekRange = useCallback(() => {
    const from = startOfWeek();
    const to = new Date();
    to.setDate(to.getDate() + 1);
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);

  const flushQueue = useCallback(async (): Promise<number> => {
    const pending = queueRef.current;
    if (pending.length === 0) {
      return 0;
    }
    let sent = 0;
    const remaining: QueuedEntry[] = [];
    for (const item of pending) {
      try {
        await clientRef.current.createManualEntry(
          item.payload as unknown as ManualEntryInput & { startedAt?: string; endedAt?: string },
        );
        sent += 1;
      } catch (flushError) {
        if (flushError instanceof NetworkError) {
          remaining.push(item);
        }
      }
    }
    if (sent > 0) {
      setQueue(remaining);
      queueRef.current = remaining;
      setNotice(`${sent} queued ${sent === 1 ? 'entry' : 'entries'} synced.`);
    }
    return sent;
  }, []);

  const loadFromServer = useCallback(async () => {
    const client = clientRef.current;
    const range = weekRange();
    const [org, projectList, items, currentTimer, entryList, connection, rates] =
      await Promise.all([
        client.organisation(),
        client.projects(true),
        client.workItems(),
        client.timer(),
        client.timeEntries(range.from, range.to),
        client.planeConnection(),
        client.fxRates(),
      ]);
    setOrganisation(org);
    setProjects(projectList);
    setWorkItems(items);
    setEntries(entryList);
    setPlaneConnection(connection);
    setFx(rates);
    if (timerSourceRef.current === 'server') {
      setTimer(currentTimer);
    }
    setOnline(true);
  }, [weekRange]);

  const refresh = useCallback(async () => {
    if (!tokenRef.current) {
      return;
    }
    setRefreshing(true);
    try {
      const current = await clientRef.current.me();
      setMember(current);
      const sent = await flushQueue();
      if (sent === 0 && queueRef.current.length > 0) {
        setOnline(false);
        return;
      }
      await loadFromServer();
    } catch (refreshError) {
      if (refreshError instanceof NetworkError) {
        setOnline(false);
        setNotice('Offline. Showing locally cached data.');
      } else if (refreshError instanceof ApiError && refreshError.status === 401) {
        tokenRef.current = null;
        await deleteSecret(SESSION_KEY);
        setMember(null);
        setStatus('login');
      } else {
        setError(refreshError instanceof Error ? refreshError.message : 'refresh failed');
      }
    } finally {
      setRefreshing(false);
    }
  }, [flushQueue, loadFromServer]);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      const [savedUrl, cached] = await Promise.all([
        loadSecret(SERVER_KEY),
        readCacheFile(),
      ]);
      if (cancelled) {
        return;
      }
      const url = savedUrl ?? DEFAULT_BASE_URL;
      setBaseUrl(url);
      clientRef.current.setBaseUrl(url);

      if (cached) {
        try {
          const snapshot = JSON.parse(cached) as CacheSnapshot;
          setMember(snapshot.member);
          setOrganisation(snapshot.organisation);
          setProjects(snapshot.projects ?? []);
          setWorkItems(snapshot.workItems ?? []);
          setEntries(snapshot.entries ?? []);
          setTimer(snapshot.timer ?? null);
          setQueue(snapshot.queue ?? []);
          if (snapshot.member) {
            setStatus('ready');
          }
        } catch {
          // ignore a corrupt cache
        }
      }

      const token = await loadSecret(SESSION_KEY);
      if (cancelled) {
        return;
      }
      if (!token) {
        setStatus((current) => (current === 'ready' ? current : 'login'));
        return;
      }
      tokenRef.current = token;
      clientRef.current.setToken(token);
      setStatus('ready');
      void refresh();
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const login = useCallback(
    async (url: string, email: string, password: string) => {
      const client = new ApiClient({ baseUrl: url });
      const result = await client.login(email, password);
      client.setToken(result.token);
      clientRef.current = client;
      tokenRef.current = result.token;
      setBaseUrl(url);
      setMember(result.member);
      setStatus('ready');
      setError(null);
      await Promise.all([saveSecret(SESSION_KEY, result.token), saveSecret(SERVER_KEY, url)]);
      timerSourceRef.current = 'server';
      await loadFromServer();
    },
    [loadFromServer],
  );

  const logout = useCallback(async () => {
    tokenRef.current = null;
    clientRef.current.setToken(null);
    setMember(null);
    setProjects([]);
    setWorkItems([]);
    setEntries([]);
    setTimer(null);
    setQueue([]);
    await deleteSecret(SESSION_KEY);
    setStatus('login');
  }, []);

  const ensureClient = useCallback(() => {
    clientRef.current.setToken(tokenRef.current);
    return clientRef.current;
  }, []);

  const startTimer = useCallback(
    async (workItemId: string | null) => {
      const item = workItems.find((entry) => entry.plane_work_item_id === workItemId);
      const optimistic: RunningTimer = {
        member_id: member?.id ?? 'local',
        project_id: item?.project_id ?? null,
        work_item_id: workItemId,
        description: item ? `${item.identifier ?? ''} ${item.name}`.trim() : null,
        started_at: new Date().toISOString(),
      };
      setTimer(optimistic);
      setTimerPending(true);
      try {
        const result = await ensureClient().startTimer(workItemId);
        timerSourceRef.current = 'server';
        setTimer(result.timer);
      } catch (startError) {
        if (startError instanceof NetworkError) {
          timerSourceRef.current = 'local';
          setOnline(false);
          setNotice('Offline. Timer is local until you stop it; the entry will queue.');
        } else if (startError instanceof ApiError && startError.status === 401) {
          await logout();
        } else {
          setTimer(null);
          setError(startError instanceof Error ? startError.message : 'could not start timer');
        }
      } finally {
        setTimerPending(false);
      }
    },
    [ensureClient, logout, member, workItems],
  );

  const stopTimer = useCallback(async () => {
    if (!timer) {
      return;
    }
    const finished: RunningTimer = timer;
    setTimer(null);
    setTimerPending(true);
    try {
      if (timerSourceRef.current === 'local') {
        throw new NetworkError();
      }
      await ensureClient().stopTimer();
      timerSourceRef.current = 'server';
      await refresh();
    } catch (stopError) {
      if (stopError instanceof NetworkError) {
        const queued: QueuedEntry = {
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          payload: {
            workItemId: finished.work_item_id,
            description: finished.description,
            startedAt: finished.started_at,
            endedAt: new Date().toISOString(),
          },
        };
        setQueue((current) => [...current, queued]);
        setOnline(false);
        setNotice('Offline. Entry queued and will sync when the server is reachable.');
        timerSourceRef.current = 'server';
      } else {
        setError(stopError instanceof Error ? stopError.message : 'could not stop timer');
      }
    } finally {
      setTimerPending(false);
    }
  }, [ensureClient, refresh, timer]);

  const addManualEntry = useCallback(
    async (input: ManualEntryInput) => {
      try {
        await ensureClient().createManualEntry(input);
        await refresh();
      } catch (manualError) {
        if (manualError instanceof NetworkError) {
          const queued: QueuedEntry = {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            payload: { ...input },
          };
          setQueue((current) => [...current, queued]);
          setOnline(false);
          setNotice('Offline. Back-filled entry queued.');
          return;
        }
        throw manualError;
      }
    },
    [ensureClient, refresh],
  );

  const setFeedbackOptIn = useCallback(
    async (optIn: boolean) => {
      const updated = await ensureClient().setFeedbackOptIn(optIn);
      setMember(updated);
    },
    [ensureClient],
  );

  const savePlaneConnection = useCallback(
    async (input: { baseUrl: string; workspaceSlug: string; token: string }) => {
      const result = await ensureClient().savePlaneConnection(input);
      await refresh();
      return `Connected to ${result.workspace.slug} (${result.workspace.projectCount} projects)`;
    },
    [ensureClient, refresh],
  );

  const syncPlane = useCallback(async () => {
    const result = await ensureClient().syncPlane();
    await refresh();
    return `Synced ${result.projects} projects and ${result.workItems} work items`;
  }, [ensureClient, refresh]);

  const value = useMemo<AppValue>(
    () => ({
      status,
      baseUrl,
      member,
      organisation,
      projects,
      workItems,
      entries,
      timer,
      planeConnection,
      fx,
      timerPending,
      queue,
      online,
      refreshing,
      error,
      notice,
      login,
      logout,
      refresh,
      startTimer,
      stopTimer,
      addManualEntry,
      setFeedbackOptIn,
      savePlaneConnection,
      syncPlane,
      dismiss: () => {
        setError(null);
        setNotice(null);
      },
    }),
    [
      status,
      baseUrl,
      member,
      organisation,
      projects,
      workItems,
      entries,
      timer,
      planeConnection,
      fx,
      timerPending,
      queue,
      online,
      refreshing,
      error,
      notice,
      login,
      logout,
      refresh,
      startTimer,
      stopTimer,
      addManualEntry,
      setFeedbackOptIn,
      savePlaneConnection,
      syncPlane,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppValue {
  const value = useContext(AppContext);
  if (!value) {
    throw new Error('useApp must be used inside AppProvider');
  }
  return value;
}
