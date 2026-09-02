"use client";

import { useState } from "react";

/**
 * Presentation only. Pieces sit in the opening position, squares highlight on
 * click, and the board can be flipped — but there are no rules, no move
 * validation and no server behind any of it yet.
 */

const START: (string | null)[][] = [
  ["r", "n", "b", "q", "k", "b", "n", "r"],
  ["p", "p", "p", "p", "p", "p", "p", "p"],
  [null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null],
  ["P", "P", "P", "P", "P", "P", "P", "P"],
  ["R", "N", "B", "Q", "K", "B", "N", "R"],
];

const GLYPH: Record<string, string> = {
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
  K: "♚", Q: "♛", R: "♜", B: "♝", N: "♞", P: "♟",
};

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

export function ChessBoard() {
  const [flipped, setFlipped] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const rows = flipped ? [...START].reverse().map((r) => [...r].reverse()) : START;
  const rankLabels = flipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const fileLabels = flipped ? [...FILES].reverse() : FILES;

  return (
    <div className="w-full">
      <div className="panel overflow-hidden p-3 sm:p-4">
        <div className="grid grid-cols-8 overflow-hidden rounded-xl">
          {rows.map((row, r) =>
            row.map((piece, c) => {
              const square = `${fileLabels[c]}${rankLabels[r]}`;
              const isDark = (r + c) % 2 === 1;
              const isSelected = selected === square;
              const isWhite = piece ? piece === piece.toUpperCase() : false;

              return (
                <button
                  key={square}
                  onClick={() => setSelected(isSelected ? null : square)}
                  className="relative aspect-square transition-colors"
                  style={{
                    background: isSelected
                      ? "var(--lime)"
                      : isDark
                        ? "#4b3f86"
                        : "#cfc6f0",
                  }}
                  aria-label={`${square}${piece ? ` ${isWhite ? "white" : "black"} piece` : " empty"}`}
                >
                  {/* coordinates, chess.com style */}
                  {c === 0 && (
                    <span
                      className="absolute left-0.5 top-0 text-[9px] font-bold sm:text-[10px]"
                      style={{ color: isDark ? "#cfc6f0" : "#4b3f86" }}
                    >
                      {rankLabels[r]}
                    </span>
                  )}
                  {r === 7 && (
                    <span
                      className="absolute bottom-0 right-0.5 text-[9px] font-bold sm:text-[10px]"
                      style={{ color: isDark ? "#cfc6f0" : "#4b3f86" }}
                    >
                      {fileLabels[c]}
                    </span>
                  )}

                  {piece && (
                    <span
                      className="grid h-full w-full place-items-center text-[7vw] leading-none sm:text-4xl lg:text-5xl"
                      style={{
                        color: isWhite ? "#fbfaff" : "#221b45",
                        textShadow: isWhite
                          ? "0 1px 2px rgba(0,0,0,0.55)"
                          : "0 1px 1px rgba(255,255,255,0.18)",
                      }}
                    >
                      {GLYPH[piece]}
                    </span>
                  )}
                </button>
              );
            }),
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-dim">
          {selected ? `Square ${selected} selected` : "Tap a square to highlight it"}
        </span>
        <button
          onClick={() => setFlipped((f) => !f)}
          className="rounded-xl border border-line-soft px-4 py-2 text-xs font-semibold text-muted transition-colors hover:text-ink"
        >
          Flip board
        </button>
      </div>
    </div>
  );
}
