import { randomInt } from "node:crypto";
import englishWords from "an-array-of-english-words";

/**
 * Answers are a curated list of common words — a duel for money shouldn't turn
 * on whether someone knows "aalii". Guesses are checked against the full
 * English dictionary filtered to five letters, so players aren't fighting the
 * word list while the clock runs.
 */
export const ANSWERS: string[] = [
  "about", "above", "abuse", "actor", "acute", "admit", "adopt", "adult", "after", "again",
  "agent", "agree", "ahead", "alarm", "album", "alert", "alike", "alive", "allow", "alone",
  "along", "alter", "among", "anger", "angle", "angry", "apart", "apple", "apply", "arena",
  "argue", "arise", "armor", "array", "arrow", "aside", "asset", "audio", "audit", "avoid",
  "award", "aware", "badly", "baker", "basic", "batch", "beach", "began", "begin", "being",
  "below", "bench", "birth", "black", "blade", "blame", "blank", "blast", "blend", "bless",
  "blind", "block", "blood", "board", "boost", "booth", "bound", "brain", "brand", "brave",
  "bread", "break", "breed", "brick", "brief", "bring", "broad", "broke", "brown", "brush",
  "build", "built", "bunch", "burst", "buyer", "cabin", "cable", "carry", "catch", "cause",
  "chain", "chair", "chalk", "charm", "chart", "chase", "cheap", "check", "chest", "chief",
  "child", "china", "chose", "civil", "claim", "class", "clean", "clear", "click", "climb",
  "clock", "close", "cloth", "cloud", "coach", "coast", "could", "count", "court", "cover",
  "crack", "craft", "crash", "crazy", "cream", "crime", "cross", "crowd", "crown", "crude",
  "curve", "cycle", "daily", "dance", "dated", "dealt", "death", "debut", "delay", "depth",
  "doing", "doubt", "dozen", "draft", "drama", "drank", "dream", "dress", "drink", "drive",
  "drove", "dying", "eager", "early", "earth", "eight", "elite", "empty", "enemy", "enjoy",
  "enter", "entry", "equal", "error", "event", "every", "exact", "exist", "extra", "faith",
  "false", "fault", "favor", "fence", "fever", "field", "fifth", "fifty", "fight", "final",
  "first", "fixed", "flame", "flash", "fleet", "floor", "focus", "force", "forth", "forty",
  "forum", "found", "frame", "fraud", "fresh", "front", "frost", "fruit", "fully", "funny",
  "ghost", "giant", "given", "glass", "globe", "glory", "grace", "grade", "grain", "grand",
  "grant", "grape", "grass", "grave", "great", "green", "grief", "gross", "group", "grown",
  "guard", "guess", "guest", "guide", "happy", "harsh", "heart", "heavy", "hence", "honey",
  "honor", "horse", "hotel", "house", "human", "humor", "ideal", "image", "index", "inner",
  "input", "irony", "issue", "ivory", "japan", "joint", "judge", "juice", "known", "label",
  "labor", "large", "laser", "later", "laugh", "layer", "learn", "lease", "least", "leave",
  "legal", "lemon", "level", "light", "limit", "linen", "links", "liver", "local", "logic",
  "loose", "lower", "lucky", "lunch", "lying", "magic", "major", "maker", "march", "match",
  "maybe", "mayor", "meant", "medal", "media", "medic", "mercy", "merge", "merit", "metal",
  "meter", "might", "minor", "minus", "mixed", "model", "moral", "motor", "mount", "mouse",
  "mouth", "movie", "music", "naked", "nerve", "never", "newly", "night", "noble", "noise",
  "north", "novel", "nurse", "occur", "ocean", "offer", "often", "olive", "onion", "order",
  "organ", "other", "ought", "outer", "owner", "paint", "panel", "panic", "paper", "party",
  "pause", "peace", "phase", "phone", "photo", "piano", "piece", "pilot", "pitch", "place",
  "plain", "plane", "plant", "plate", "point", "polar", "porch", "pound", "power", "press",
  "price", "pride", "prime", "print", "prior", "prize", "proof", "proud", "prove", "pulse",
  "punch", "pupil", "queen", "query", "quest", "quick", "quiet", "quite", "quota", "radio",
  "raise", "rally", "range", "rapid", "ratio", "reach", "ready", "realm", "rebel", "refer",
  "relax", "renew", "reply", "rider", "ridge", "rifle", "right", "rigid", "risky", "rival",
  "river", "robot", "rocky", "roman", "rough", "round", "route", "royal", "rural", "salad",
  "sales", "sauce", "scale", "scene", "scope", "score", "sense", "serve", "seven", "shade",
  "shaft", "shake", "shall", "shape", "share", "sharp", "sheep", "sheet", "shelf", "shell",
  "shift", "shine", "shirt", "shock", "shoot", "shore", "short", "shown", "sight", "since",
  "sixth", "sixty", "skill", "sleep", "slice", "slide", "slope", "small", "smart", "smile",
  "smoke", "snake", "solar", "solid", "solve", "sorry", "sound", "south", "space", "spare",
  "speak", "speed", "spend", "spent", "spice", "spike", "spine", "spite", "split", "spoke",
  "sport", "staff", "stage", "stake", "stand", "start", "state", "steam", "steel", "steep",
  "steer", "stick", "still", "stock", "stone", "stood", "store", "storm", "story", "stove",
  "strap", "straw", "strip", "study", "stuff", "style", "sugar", "suite", "sunny", "super",
  "sweet", "swift", "swing", "sword", "table", "taken", "taste", "teach", "teeth", "tempo",
  "tenth", "thank", "theft", "their", "theme", "there", "these", "thick", "thing", "think",
  "third", "those", "three", "threw", "throw", "thumb", "tiger", "tight", "timer", "tired",
  "title", "today", "token", "tooth", "topic", "total", "touch", "tough", "tower", "town",
  "trace", "track", "trade", "trail", "train", "trait", "trash", "treat", "trend", "trial",
  "tribe", "trick", "tried", "troop", "truck", "truly", "trust", "truth", "twice", "twist",
  "ultra", "uncle", "under", "union", "unite", "unity", "until", "upper", "upset", "urban",
  "usage", "usual", "valid", "value", "video", "villa", "vinyl", "virus", "visit", "vital",
  "vivid", "vocal", "voice", "wagon", "waste", "watch", "water", "weigh", "weird", "whale",
  "wheat", "wheel", "where", "which", "while", "white", "whole", "whose", "widow", "width",
  "world", "worry", "worse", "worst", "worth", "would", "wound", "wrist", "write", "wrong",
  "yield", "young", "youth",
].filter((w) => w.length === 5);

const g = globalThis as unknown as { __wdDictionary?: Set<string> };

/** ~12.6k five-letter words, built once per process. */
export function dictionary(): Set<string> {
  if (!g.__wdDictionary) {
    const set = new Set<string>();
    for (const word of englishWords as string[]) {
      if (word.length === 5 && /^[a-z]{5}$/.test(word)) set.add(word);
    }
    for (const word of ANSWERS) set.add(word);
    g.__wdDictionary = set;
  }
  return g.__wdDictionary;
}

export const isValidGuess = (word: string) => dictionary().has(word.toLowerCase());

/** Cryptographically random so nobody can predict the next match's word. */
export const pickAnswer = () => ANSWERS[randomInt(ANSWERS.length)];

export type Tile = "g" | "y" | "b";

/**
 * Standard Wordle marking, including the duplicate-letter rule: greens are
 * assigned first, then yellows draw from whatever letters are left over.
 */
export function score(guess: string, answer: string): string {
  const g5 = guess.toLowerCase().split("");
  const a5 = answer.toLowerCase().split("");
  const result: Tile[] = ["b", "b", "b", "b", "b"];
  const remaining = new Map<string, number>();

  for (let i = 0; i < 5; i++) {
    if (g5[i] === a5[i]) result[i] = "g";
    else remaining.set(a5[i], (remaining.get(a5[i]) ?? 0) + 1);
  }

  for (let i = 0; i < 5; i++) {
    if (result[i] === "g") continue;
    const left = remaining.get(g5[i]) ?? 0;
    if (left > 0) {
      result[i] = "y";
      remaining.set(g5[i], left - 1);
    }
  }

  return result.join("");
}
