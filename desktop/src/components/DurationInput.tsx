import {
  durationError,
  formatDurationClock,
  formatDurationHours,
  parseDuration,
} from '../lib/format';

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
    </>
  );
}
