// @ts-check
/**
 * A counter that goes up each time the app refreshes its data (the Refresh button, the 10-minute
 * background refresh, or returning to the tab). Pages that load their own detail data (a match's
 * lineups and events, a player's statistics) depend on it, so a refresh reaches them too instead
 * of only reloading the shared lists.
 */
import { useSyncExternalStore } from "react";

let epoch = 0;
const subscribers = new Set();

export const getRefreshEpoch = () => epoch;

export function bumpRefreshEpoch() {
  epoch++;
  subscribers.forEach((notify) => notify());
}

const subscribe = (notify) => {
  subscribers.add(notify);
  return () => subscribers.delete(notify);
};

export const useRefreshEpoch = () => useSyncExternalStore(subscribe, getRefreshEpoch, () => 0);
