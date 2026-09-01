import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import type { ComboboxOption, ComboboxSource } from '../lib/combobox-filter';

/**
 * Accessible autocomplete combobox, WAI-ARIA "combobox with listbox popup,
 * activedescendant" pattern: the text `<input role="combobox">` never moves
 * focus into the popup; the currently-active option is tracked via
 * `aria-activedescendant` and announced through a polite live region.
 *
 * Sources are `ComboboxSource` (see `lib/combobox-filter.ts`): local
 * static datasets resolve synchronously with no artificial debounce; a
 * remote source gets the same sequence-guard + `AbortSignal` cancellation
 * below for free, so a stale response can never overwrite a newer query's
 * results.
 *
 * This component intentionally does NOT auto-fill the input with a
 * selected option's label, and does NOT itself commit free-typed text on
 * Enter with nothing active: every caller in this app pairs it with its
 * own existing "Add" button/validation (CPV 8-digit check, country 2-letter
 * uppercasing, etc.), so free text stays exactly as governed by that
 * caller. Selecting a suggestion (keyboard Enter/Tab, mouse click, or touch
 * tap) calls `onCommit` immediately; the caller decides what that means
 * (usually: push it onto a list and clear the field).
 */

export interface ComboboxProps<T extends ComboboxOption = ComboboxOption> {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly onCommit: (option: T) => void;
  readonly source: ComboboxSource<T>;
  readonly placeholder?: string | undefined;
  /** Short instruction shown under the label (e.g. "Type to search, or enter your own 8-digit code"). */
  readonly hint?: string | undefined;
  readonly noResultsLabel?: string | undefined;
  /** Marks an option as already chosen elsewhere (e.g. already added to the
   * caller's list), rendered as a visually distinct state from "active"
   * (the keyboard/pointer-highlighted option), never conflated with it. */
  readonly isChosen?: ((option: T) => boolean) | undefined;
  readonly disabled?: boolean | undefined;
  /** Extra id(s) to merge into the input's `aria-describedby` (e.g. an inline field error). */
  readonly describedBy?: string | undefined;
  /** Pass-through to the native input's `maxlength` (e.g. 2 for an ISO country code). */
  readonly maxLength?: number | undefined;
}

export function Combobox<T extends ComboboxOption = ComboboxOption>({
  id,
  label,
  value,
  onValueChange,
  onCommit,
  source,
  placeholder,
  hint,
  noResultsLabel = 'No matches',
  isChosen,
  disabled = false,
  describedBy,
  maxLength,
}: ComboboxProps<T>): ReactElement {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<readonly T[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [escapedOnce, setEscapedOnce] = useState(false);

  // Sequence guard (stale-result protection): a response only applies if it
  // is still the MOST RECENT request issued, so an out-of-order/late response
  // to an earlier query can never overwrite newer results.
  const seqRef = useRef(0);

  const listboxId = `${id}-listbox`;
  const hintId = hint !== undefined ? `${id}-hint` : undefined;
  const describedByIds =
    [hintId, describedBy].filter((v): v is string => v !== undefined).join(' ') || undefined;

  useEffect(() => {
    if (!open) return;
    const seq = ++seqRef.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    source(value, controller.signal)
      .then((results) => {
        if (seq !== seqRef.current) return; // superseded by a newer query
        setOptions(results);
        setActiveIndex(results.length > 0 ? 0 : null);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (seq !== seqRef.current) return;
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError('Could not load suggestions. Please try again.');
        setOptions([]);
        setActiveIndex(null);
        setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [value, open, source]);

  function openPopup(): void {
    if (disabled) return;
    setOpen(true);
  }

  function closePopup(): void {
    setOpen(false);
    setActiveIndex(null);
  }

  function commit(option: T): void {
    onCommit(option);
    closePopup();
  }

  function moveActive(delta: 1 | -1): void {
    if (options.length === 0) return;
    setActiveIndex((current) => {
      const base = current ?? (delta > 0 ? -1 : 0);
      return (base + delta + options.length) % options.length;
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        if (!open) openPopup();
        else moveActive(1);
        return;
      }
      case 'ArrowUp': {
        event.preventDefault();
        if (!open) openPopup();
        else moveActive(-1);
        return;
      }
      case 'Enter': {
        if (!open || activeIndex === null) return;
        const active = options[activeIndex];
        if (active === undefined) return;
        event.preventDefault();
        commit(active);
        return;
      }
      case 'Escape': {
        if (open) {
          event.preventDefault();
          closePopup();
          setEscapedOnce(true);
          return;
        }
        // Second Escape (popup already closed) clears the field.
        if (escapedOnce && value.length > 0) {
          event.preventDefault();
          onValueChange('');
          setEscapedOnce(false);
        }
        return;
      }
      case 'Tab': {
        // Commits the active option (if any) but never calls
        // preventDefault: focus must still move to the next element.
        if (open && activeIndex !== null) {
          const active = options[activeIndex];
          if (active !== undefined) commit(active);
        } else {
          closePopup();
        }
        return;
      }
      default:
        return;
    }
  }

  const activeOptionId =
    open && activeIndex !== null && options[activeIndex] !== undefined
      ? `${id}-option-${String(activeIndex)}`
      : undefined;

  const announcement = !open
    ? ''
    : loading
      ? 'Loading suggestions…'
      : error !== null
        ? error
        : options.length === 0
          ? noResultsLabel
          : `${String(options.length)} suggestion${options.length === 1 ? '' : 's'} available`;

  return (
    <div className="combobox">
      <label htmlFor={id}>{label}</label>
      {hint !== undefined && (
        <p id={hintId} className="hint combobox__hint">
          {hint}
        </p>
      )}
      <div className="combobox__field">
        <input
          id={id}
          role="combobox"
          type="text"
          autoComplete="off"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={activeOptionId}
          aria-describedby={describedByIds}
          disabled={disabled}
          maxLength={maxLength}
          value={value}
          placeholder={placeholder}
          onChange={(event) => {
            onValueChange(event.target.value);
            setEscapedOnce(false);
            openPopup();
          }}
          onFocus={openPopup}
          onBlur={closePopup}
          onKeyDown={handleKeyDown}
        />
        {open && (
          <div className="combobox__popup">
            <ul role="listbox" id={listboxId} aria-label={label} className="combobox__list">
              {options.map((option, index) => {
                const optionId = `${id}-option-${String(index)}`;
                const active = index === activeIndex;
                const chosen = isChosen?.(option) ?? false;
                const classNames = ['combobox__option'];
                if (active) classNames.push('combobox__option--active');
                if (chosen) classNames.push('combobox__option--chosen');
                return (
                  <li
                    key={option.value}
                    id={optionId}
                    role="option"
                    aria-selected={active}
                    className={classNames.join(' ')}
                    onMouseDown={(event) => event.preventDefault()}
                    onPointerDown={(event) => event.preventDefault()}
                    onPointerUp={() => commit(option)}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    <span className="combobox__option-label">{option.label}</span>
                    {option.sublabel !== undefined && (
                      <span className="combobox__option-sublabel num">{option.sublabel}</span>
                    )}
                    {chosen && (
                      <span className="combobox__option-chosen-mark" aria-hidden="true">
                        ✓
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {loading && <p className="combobox__status">Loading…</p>}
            {!loading && error !== null && (
              <p className="combobox__status combobox__status--error" role="alert">
                {error}
              </p>
            )}
            {!loading && error === null && options.length === 0 && (
              <p className="combobox__status">{noResultsLabel}</p>
            )}
          </div>
        )}
      </div>
      <p className="visually-hidden-status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
