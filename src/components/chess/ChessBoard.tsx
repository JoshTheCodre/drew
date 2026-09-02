"use client";

import { useMemo, useState } from "react";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

const GLYPH: Record<string, string> = {
  k: "♚",
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
};

export type Piece = { type: string; colour: "w" | "b" };

/** Board field of a FEN string -> an 8x8 grid, rank 8 first. */
export function parseFen(fen: string): (Piece | null)[][] {
  const rows = fen.split(" ")[0].split("/");
  return rows.map((row) => {
    const squares: (Piece | null)[] = [];
    for (const char of row) {
      if (/\d/.test(char)) {
        for (let i = 0; i < Number(char); i++) squares.push(null);
      } else {
        squares.push({ type: char.toLowerCase(), colour: char === char.toUpperCase() ? "w" : "b" });
      }
    }
    return squares;
  });
}

const squareName = (fileIndex: number, rankIndex: number) => `${FILES[fileIndex]}${8 - rankIndex}`;

export function ChessBoard({
  fen,
  legalMoves,
  yourColour,
  lastMove,
  interactive,
  onMove,
  flipped,
}: {
  fen: string;
  legalMoves: Record<string, string[]>;
  yourColour: "w" | "b" | null;
  lastMove?: { from: string; to: string } | null;
  interactive: boolean;
  onMove: (from: string, to: string, promotion?: string) => void;
  flipped: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null);

  const grid = useMemo(() => parseFen(fen), [fen]);
  const targets = selected ? (legalMoves[selected] ?? []) : [];

  // Rank 8 renders first for white; flip both axes for black.
  const rankOrder = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const fileOrder = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

  function handleSquare(square: string, piece: Piece | null) {
    if (!interactive) return;

    if (selected && targets.includes(square)) {
      const moving = grid[8 - Number(square[1])]?.[FILES.indexOf(selected[0] as never)];
      void moving;
      const from = selected;
      const isPawn = pieceAt(grid, from)?.type === "p";
      const lastRank = square[1] === "8" || square[1] === "1";
      setSelected(null);
      if (isPawn && lastRank) {
        setPromotion({ from, to: square });
        return;
      }
      onMove(from, square);
      return;
    }

    if (piece && piece.colour === yourColour && legalMoves[square]?.length) {
      setSelected(square === selected ? null : square);
      return;
    }
    setSelected(null);
  }

  return (
    <div className="w-full">
      <div className="panel relative overflow-hidden p-2.5 sm:p-3">
        <div className="grid grid-cols-8 overflow-hidden rounded-xl">
          {rankOrder.map((r) =>
            fileOrder.map((c) => {
              const square = squareName(c, r);
              const piece = grid[r]?.[c] ?? null;
              const isDark = (r + c) % 2 === 1;
              const isSelected = selected === square;
              const isTarget = targets.includes(square);
              const isLast = lastMove?.from === square || lastMove?.to === square;
              const canLift = interactive && piece?.colour === yourColour && legalMoves[square]?.length;

              return (
                <button
                  key={square}
                  onClick={() => handleSquare(square, piece)}
                  disabled={!interactive}
                  aria-label={square}
                  className="relative aspect-square transition-colors"
                  style={{
                    background: isSelected
                      ? "var(--lime)"
                      : isLast
                        ? isDark
                          ? "#6b5ea8"
                          : "#b9adf0"
                        : isDark
                          ? "#4b3f86"
                          : "#cfc6f0",
                    cursor: canLift || isTarget ? "pointer" : "default",
                  }}
                >
                  {c === (flipped ? 7 : 0) && (
                    <span
                      className="absolute left-0.5 top-0 text-[9px] font-bold sm:text-[10px]"
                      style={{ color: isDark ? "#cfc6f0" : "#4b3f86" }}
                    >
                      {8 - r}
                    </span>
                  )}
                  {r === (flipped ? 0 : 7) && (
                    <span
                      className="absolute bottom-0 right-0.5 text-[9px] font-bold sm:text-[10px]"
                      style={{ color: isDark ? "#cfc6f0" : "#4b3f86" }}
                    >
                      {FILES[c]}
                    </span>
                  )}

                  {piece && (
                    <span
                      className="grid h-full w-full place-items-center text-[7.5vw] leading-none sm:text-4xl lg:text-5xl"
                      style={{
                        color: piece.colour === "w" ? "#fbfaff" : "#1c1638",
                        textShadow:
                          piece.colour === "w"
                            ? "0 1px 2px rgba(0,0,0,0.55)"
                            : "0 1px 1px rgba(255,255,255,0.2)",
                      }}
                    >
                      {GLYPH[piece.type]}
                    </span>
                  )}

                  {/* Legal-move hints: a dot on an empty square, a ring on a capture. */}
                  {isTarget &&
                    (piece ? (
                      <span className="pointer-events-none absolute inset-1 rounded-full border-4 border-lime/80" />
                    ) : (
                      <span className="pointer-events-none absolute left-1/2 top-1/2 h-1/4 w-1/4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-lime/80" />
                    ))}
                </button>
              );
            }),
          )}
        </div>
      </div>

      {promotion && (
        <div className="panel mt-3 flex items-center justify-center gap-3 px-5 py-4">
          <span className="text-sm text-muted">Promote to</span>
          {(["q", "r", "b", "n"] as const).map((p) => (
            <button
              key={p}
              onClick={() => {
                onMove(promotion.from, promotion.to, p);
                setPromotion(null);
              }}
              className="grid h-12 w-12 place-items-center rounded-xl bg-panel-2 text-3xl text-ink transition-colors hover:bg-line"
            >
              {GLYPH[p]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function pieceAt(grid: (Piece | null)[][], square: string): Piece | null {
  const file = FILES.indexOf(square[0] as (typeof FILES)[number]);
  const rank = 8 - Number(square[1]);
  return grid[rank]?.[file] ?? null;
}
