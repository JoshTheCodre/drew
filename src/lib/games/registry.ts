export type GameStatus = "live" | "preview" | "soon";

export type GameDefinition = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  href: string;
  status: GameStatus;
  emoji: string;
  accent: string;
  players: string;
  length: string;
  /** Shown on the arcade card so the stakes are obvious before you click. */
  stakes: "points" | "money";
};

/**
 * The arcade catalogue. A new game = a new entry here plus its own
 * lib/games/<id> engine and app/games/<id> route.
 */
export const GAMES: GameDefinition[] = [
  {
    id: "price-prediction",
    name: "Price Prediction",
    tagline: "Call the close. Closest guess takes the round.",
    description:
      "Every round locks in a live market price at a fixed future time. Submit your number before the lock, and whoever lands nearest the settlement price wins the round.",
    href: "/games/price-prediction",
    status: "live",
    emoji: "📈",
    accent: "#9d6bff",
    players: "Unlimited",
    length: "~10 min rounds",
    stakes: "points",
  },
  {
    id: "wordle-duel",
    name: "Wordle Duel",
    tagline: "Same word, two players, one pot.",
    description:
      "Both players stake the same amount and get the same five-letter word at the same second. First to solve it takes the pot minus the house fee — a $500 duel pays $900.",
    href: "/games/wordle-duel",
    status: "live",
    emoji: "🔤",
    accent: "#c8f751",
    players: "2",
    length: "~5 min",
    stakes: "money",
  },
  {
    id: "chess",
    name: "Chess Stakes",
    tagline: "Blitz chess, winner takes the pot.",
    description:
      "5+3 blitz on the same escrow rails as Wordle Duel. The board and match screen are designed and clickable — the engine, clock and settlement are still to come.",
    href: "/games/chess",
    status: "preview",
    emoji: "♟️",
    accent: "#fbbf24",
    players: "2",
    length: "5+3 blitz",
    stakes: "money",
  },
];

export const gameById = (id: string) => GAMES.find((g) => g.id === id);
