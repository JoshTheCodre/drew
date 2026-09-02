"use client";

import { useEffect, useRef, useState } from "react";

/** One colour per Wordle state; the flip keyframe reads it from --tile-fill. */
const FILL: Record<string, string> = {
  g: "#3f9c68",
  y: "#b8912f",
  b: "#241d4a",
};

/** Sequential flip, left to right. Wordle uses ~300ms; a money race wants snappier. */
const FLIP_STAGGER_MS = 200;
export const FLIP_TOTAL_MS = FLIP_STAGGER_MS * 4 + 500;

const SIZES = {
  sm: "h-9 w-9 text-sm rounded-lg",
  md: "h-13 w-13 text-2xl rounded-xl sm:h-15 sm:w-15 sm:text-3xl",
} as const;

export function Tile({
  letter,
  state,
  size = "md",
  masked = false,
  /** Column index — drives both the flip stagger and the win-bounce wave. */
  index = 0,
  revealing = false,
  bouncing = false,
}: {
  letter?: string | null;
  state?: string;
  size?: keyof typeof SIZES;
  masked?: boolean;
  index?: number;
  revealing?: boolean;
  bouncing?: boolean;
}) {
  const [popping, setPopping] = useState(false);
  const previous = useRef<string | null | undefined>(letter);

  // Letter pop: only when a character lands in a previously empty tile.
  useEffect(() => {
    if (!state && letter && !previous.current) {
      setPopping(true);
      const id = setTimeout(() => setPopping(false), 120);
      return () => clearTimeout(id);
    }
    previous.current = letter;
  }, [letter, state]);

  const filled = state ? FILL[state] : undefined;
  const settled = state
    ? "text-white"
    : letter
      ? "border-dim bg-bg-soft/60 text-ink"
      : "border-line bg-bg-soft/40 text-ink";

  return (
    <div
      className={`display grid place-items-center border-2 ${SIZES[size]} ${settled} ${
        popping ? "tile-pop" : ""
      } ${revealing ? "tile-reveal" : ""} ${bouncing ? "win-bounce" : ""}`}
      style={{
        ...(filled
          ? ({
              "--tile-fill": filled,
              // Without an active flip the tile just wears its colour.
              ...(revealing ? {} : { background: filled, borderColor: filled }),
            } as React.CSSProperties)
          : {}),
        animationDelay: revealing
          ? `${index * FLIP_STAGGER_MS}ms`
          : bouncing
            ? `${index * 90}ms`
            : undefined,
      }}
    >
      {masked ? "" : (letter ?? "")}
    </div>
  );
}

/**
 * One board: six rows of five, always all six visible. Rows never clear — the
 * whole history stays on screen so players can work back through it.
 */
export function Board({
  rows,
  current = "",
  maxGuesses,
  size = "md",
  masked = false,
  /** Row index to flip open, or null when nothing is being revealed. */
  revealRow = null,
  /** Row index to celebrate. */
  bounceRow = null,
  /** Row index to shake for an invalid word. */
  jiggleRow = null,
}: {
  rows: { guess: string | null; pattern: string }[];
  current?: string;
  maxGuesses: number;
  size?: keyof typeof SIZES;
  masked?: boolean;
  revealRow?: number | null;
  bounceRow?: number | null;
  jiggleRow?: number | null;
}) {
  const gap = size === "sm" ? "gap-1.5" : "gap-2";
  const filled = rows.length;
  const showCurrent = !masked && filled < maxGuesses;

  return (
    <div className={`flex flex-col ${gap}`} style={{ perspective: "600px" }}>
      {Array.from({ length: maxGuesses }).map((_, r) => {
        const row = rows[r];
        const isCurrentRow = showCurrent && r === filled;

        return (
          <div key={r} className={`flex ${gap} ${jiggleRow === r ? "row-jiggle" : ""}`}>
            {Array.from({ length: 5 }).map((_, c) =>
              row ? (
                <Tile
                  key={c}
                  letter={row.guess ? row.guess[c] : null}
                  state={row.pattern[c]}
                  size={size}
                  masked={masked && !row.guess}
                  index={c}
                  revealing={revealRow === r}
                  bouncing={bounceRow === r}
                />
              ) : (
                <Tile key={c} letter={isCurrentRow ? current[c] : undefined} size={size} index={c} />
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
