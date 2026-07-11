import { createEmptyCard, fsrs, Rating } from "ts-fsrs";

const STORAGE_KEY = "retro-learning-game:fsrs-cards";

const scheduler = fsrs();

function serializeCard(card) {
  return { ...card, due: card.due.toISOString(), last_review: card.last_review ? card.last_review.toISOString() : null };
}

function deserializeCard(raw) {
  return { ...raw, due: new Date(raw.due), last_review: raw.last_review ? new Date(raw.last_review) : null };
}

function loadRaw() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch (e) {
    return {};
  }
}

function saveRaw(raw) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
}

/**
 * Ensures every concept id has a card (creating a fresh, immediately-due
 * one for concepts never seen before), and returns the full card map
 * keyed by concept id.
 */
export function loadCards(conceptIds) {
  const raw = loadRaw();
  const cards = {};
  for (const id of conceptIds) {
    cards[id] = raw[id] ? deserializeCard(raw[id]) : createEmptyCard(new Date());
  }
  return cards;
}

export function saveCards(cards) {
  const raw = {};
  for (const [id, card] of Object.entries(cards)) {
    raw[id] = serializeCard(card);
  }
  saveRaw(raw);
}

/** Concept ids whose card is due now (new cards are always due immediately). */
export function getDueConceptIds(cards, now = new Date()) {
  return Object.entries(cards)
    .filter(([, card]) => card.due <= now)
    .map(([id]) => id);
}

/**
 * Updates one concept's card after a battle result and persists it.
 * won -> Rating.Good, lost -> Rating.Again. This is a simplified two-outcome
 * mapping (FSRS supports four grades); good enough for a single-question
 * encounter where there's no natural way to express "Hard" or "Easy".
 */
export function gradeConcept(cards, conceptId, won, now = new Date()) {
  const rating = won ? Rating.Good : Rating.Again;
  const result = scheduler.next(cards[conceptId], now, rating);
  cards[conceptId] = result.card;
  saveCards(cards);
  return result.card;
}

/** Earliest due date among all cards, for "next review in..." messaging. */
export function earliestDue(cards) {
  const dues = Object.values(cards).map((c) => c.due);
  if (dues.length === 0) return null;
  return new Date(Math.min(...dues.map((d) => d.getTime())));
}

export function formatTimeUntil(date, now = new Date()) {
  const ms = date.getTime() - now.getTime();
  if (ms <= 0) return "now";
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}
