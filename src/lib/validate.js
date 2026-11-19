// @ts-check
/**
 * Lightweight runtime validation for provider responses.
 *
 * Rules the parsers follow:
 *   - A response with the wrong overall structure is an error (FetchError "data"), so the section
 *     shows an error and Retry instead of an empty list that looks like "nothing to report".
 *   - A single malformed record is skipped (and counted in diagnostics), never allowed to break
 *     the rest of the response.
 *   - A missing or malformed field becomes null/empty. Never 0, never a guess.
 */
import { FetchError } from "./errors.js";
import { noteDropped } from "./diagnostics.js";

export const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export const arr = (v) => (Array.isArray(v) ? v : []);

/** Non-empty string, else null. */
export const str = (v) =>
  typeof v === "string" && v.trim() !== ""
    ? v
    : v != null && typeof v === "number" && Number.isFinite(v)
      ? String(v)
      : null;

/** Finite number, else null. Understands { value } / { displayValue } wrappers; blank strings are null, not 0. */
export function num(v) {
  if (v == null) return null;
  if (typeof v === "object") v = v.value ?? v.displayValue;
  if (typeof v === "string" && v.trim() === "") return null;
  if (typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Valid Date, else null. */
export function date(v) {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The response must be a JSON object. */
export function expectObject(json, what) {
  if (!isObj(json)) throw new FetchError(`Unexpected response format (${what})`, "data");
  return json;
}

/** The value must be an array (it may be empty). */
export function expectArray(value, what) {
  if (!Array.isArray(value)) throw new FetchError(`Unexpected response format (${what})`, "data");
  return value;
}

/** Keeps the records `ok` accepts; reports how many were skipped. */
export function keepValid(list, ok, label) {
  const kept = [];
  let dropped = 0;
  for (const item of list) ok(item) ? kept.push(item) : dropped++;
  if (dropped) noteDropped(label, dropped);
  return kept;
}
