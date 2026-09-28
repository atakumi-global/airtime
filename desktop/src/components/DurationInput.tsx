import {
  durationError,
  formatDuration,
  formatDurationClock,
  formatDurationHours,
  parseDuration,
} from '../lib/format';

const QUICK_DURATIONS = ['30m', '1h', '1h 30m', '1d', '1w', '+15m'];

export function DurationInput({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const minutes = parseDuration(value);
  const error = durationError(value);
  const showError = error !== null && value.trim() !== '';
  const parseId = id ? `${id}-parse` : undefined;
  const errorId = id ? `${id}-error` : undefined;
  const describedBy = showError
    ? errorId
    : minutes !== null && minutes > 0
      ? parseId
      : undefined;

  const applyQuick = (quick: string) => {
    if (quick.startsWith('+')) {
      const delta = parseDuration(quick) ?? 0;
      const base = minutes !== null && minutes > 0 ? minutes : 0;
      onChange(formatDuration(base + delta));
      return;
    }
    onChange(quick);
  };

  return (
    <>
      <input
        className="input mono"
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={showError}
        aria-describedby={describedBy}
        autoComplete="off"
        spellCheck={false}
      />
      {!showError && minutes !== null && minutes > 0 ? (
        <span className="dur-parse" id={parseId}>
          {'= '}
          <b>{formatDurationClock(minutes)}</b>
          {' · '}
          {formatDurationHours(minutes)}
        </span>
      ) : null}
      {showError ? (
        <span className="err" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
      <div className="dur-chips" role="group" aria-label="Quick durations">
        {QUICK_DURATIONS.map((quick) => (
          <button
            key={quick}
            type="button"
            className="dur-chip"
            onClick={() => applyQuick(quick)}
          >
            {quick}
          </button>
        ))}
      </div>
    </>
  );
}
