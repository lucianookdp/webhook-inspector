export function FilterBar({
  method,
  query,
  onMethodChange,
  onQueryChange,
}: {
  method: string;
  query: string;
  onMethodChange: (method: string) => void;
  onQueryChange: (query: string) => void;
}) {
  return (
    <div className="filter-bar">
      <input
        type="text"
        className="filter-bar__method"
        placeholder="Method"
        value={method}
        onChange={(event) => onMethodChange(event.target.value)}
        aria-label="Filter by method"
      />
      <input
        type="search"
        className="filter-bar__search"
        placeholder="Search path, body, headers..."
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        aria-label="Search requests"
      />
      {(method || query) && (
        <button
          type="button"
          className="filter-bar__clear"
          onClick={() => {
            onMethodChange('');
            onQueryChange('');
          }}
        >
          Clear
        </button>
      )}
    </div>
  );
}
