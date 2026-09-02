"use client";

const TILE: Record<string, string> = {
  g: "bg-[#3f9c68] border-[#3f9c68] text-white",
  y: "bg-[#b8912f] border-[#b8912f] text-white",
  b: "bg-[#241d4a] border-[#241d4a] text-dim",
};

export function Tile({
  letter,
  state,
  size = "md",
  masked = false,
  index = 0,
}: {
  letter?: string | null;
  state?: string;
  size?: "sm" | "md";
  masked?: boolean;
  index?: number;
}) {
  const dims =
    size === "sm"
      ? "h-9 w-9 text-sm rounded-lg"
      : "h-13 w-13 text-2xl rounded-xl sm:h-15 sm:w-15 sm:text-3xl";
  const skin = state ? TILE[state] : "border-line bg-bg-soft/50 text-ink";

  return (
    <div
      className={`display grid place-items-center border-2 transition-colors ${dims} ${skin} ${
        state ? "flip-in" : ""
      }`}
      style={state ? { animationDelay: `${index * 60}ms` } : undefined}
    >
      {masked ? "" : (letter ?? "")}
    </div>
  );
}

/** One board: six rows of five. A live opponent's letters stay hidden. */
export function Board({
  rows,
  current = "",
  maxGuesses,
  size = "md",
  masked = false,
}: {
  rows: { guess: string | null; pattern: string }[];
  current?: string;
  maxGuesses: number;
  size?: "sm" | "md";
  masked?: boolean;
}) {
  const gap = size === "sm" ? "gap-1.5" : "gap-2";
  const filled = rows.length;
  const showCurrent = !masked && filled < maxGuesses;

  return (
    <div className={`flex flex-col ${gap}`}>
      {Array.from({ length: maxGuesses }).map((_, r) => {
        const row = rows[r];
        const isCurrentRow = showCurrent && r === filled;

        return (
          <div key={r} className={`flex ${gap}`}>
            {Array.from({ length: 5 }).map((_, c) =>
              row ? (
                <Tile
                  key={c}
                  letter={row.guess ? row.guess[c] : null}
                  state={row.pattern[c]}
                  size={size}
                  masked={masked && !row.guess}
                  index={c}
                />
              ) : (
                <Tile key={c} letter={isCurrentRow ? current[c] : undefined} size={size} />
              ),
            )}
          </div>
        );
      })}
    </div>
  );
}

const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

export function Keyboard({
  letterStates,
  onKey,
  disabled,
}: {
  letterStates: Record<string, string>;
  onKey: (key: string) => void;
  disabled?: boolean;
}) {
  const skin = (state?: string) =>
    state === "g"
      ? "bg-[#3f9c68] text-white"
      : state === "y"
        ? "bg-[#b8912f] text-white"
        : state === "b"
          ? "bg-[#1b1540] text-dim"
          : "bg-panel-2 text-ink hover:bg-line";

  return (
    <div className="flex select-none flex-col items-center gap-2">
      {KEY_ROWS.map((row, i) => (
        <div key={row} className="flex gap-1.5">
          {i === 2 && (
            <button
              onClick={() => onKey("enter")}
              disabled={disabled}
              className="display rounded-xl bg-lime px-4 text-xs text-bg disabled:opacity-40"
            >
              Enter
            </button>
          )}
          {row.split("").map((k) => (
            <button
              key={k}
              onClick={() => onKey(k)}
              disabled={disabled}
              className={`display h-12 w-[8.5vw] max-w-[44px] min-w-[27px] rounded-xl text-sm transition-colors disabled:opacity-40 ${skin(
                letterStates[k],
              )}`}
            >
              {k}
            </button>
          ))}
          {i === 2 && (
            <button
              onClick={() => onKey("backspace")}
              disabled={disabled}
              className="rounded-xl bg-panel-2 px-4 text-base text-ink disabled:opacity-40"
            >
              ⌫
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
