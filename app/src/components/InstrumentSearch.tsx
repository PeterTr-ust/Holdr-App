/**
 * Search field with debounced results for finding an instrument by name,
 * ticker symbol or ISIN. Used when adding positions and watchlist entries.
 */
import { useEffect, useId, useState } from "react";
import type { InstrumentSearchResult } from "../domain/types";
import { useI18n } from "../i18n";
import { useApp } from "../state/AppState";

const SEARCH_DELAY_MS = 300;

type SearchState =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "done"; results: InstrumentSearchResult[] }
  | { status: "error" };

export function InstrumentSearch({ onPick }: { onPick(result: InstrumentSearchResult): void }) {
  const { t } = useI18n();
  const { searchInstruments } = useApp();
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ status: "idle" });

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearch({ status: "searching" });
      searchInstruments(term).then(
        (results) => !cancelled && setSearch({ status: "done", results }),
        () => !cancelled && setSearch({ status: "error" }),
      );
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, searchInstruments]);

  return (
    <>
      <div className="field">
        <label htmlFor={inputId}>{t("add.searchLabel")}</label>
        <input
          id={inputId}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder={t("add.searchPlaceholder")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            if (event.target.value.trim().length < 2) setSearch({ status: "idle" });
          }}
        />
      </div>
      <SearchResults state={search} onPick={onPick} />
    </>
  );
}

/** The chosen instrument, with an option to go back to the search. */
export function PickedInstrument({
  result,
  onChange,
}: {
  result: InstrumentSearchResult;
  onChange?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="picked">
      <div>
        <strong>{result.name}</strong>
        <small className="num muted">
          {result.symbol}
          {result.exchange ? ` · ${result.exchange}` : ""}
        </small>
      </div>
      {onChange && (
        <button type="button" className="btn btn-text" onClick={onChange}>
          {t("add.change")}
        </button>
      )}
    </div>
  );
}

function SearchResults({
  state,
  onPick,
}: {
  state: SearchState;
  onPick(result: InstrumentSearchResult): void;
}) {
  const { t } = useI18n();
  switch (state.status) {
    case "idle":
      return null;
    case "searching":
      return <p className="muted">{t("add.searching")}</p>;
    case "error":
      return <p className="form-error">{t("add.searchError")}</p>;
    case "done":
      if (state.results.length === 0) return <p className="muted">{t("add.noResults")}</p>;
      return (
        <ul className="search-results">
          {state.results.map((result) => (
            <li key={result.symbol}>
              <button type="button" onClick={() => onPick(result)}>
                <span>
                  <strong>{result.name}</strong>
                  <small>{result.symbol}</small>
                </span>
                <small>{[result.exchange, result.kind].filter(Boolean).join(" · ")}</small>
              </button>
            </li>
          ))}
        </ul>
      );
  }
}
