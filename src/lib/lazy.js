// @ts-check
import { lazy } from "react";

/** True for the errors browsers raise when a code-split chunk can't be fetched. */
export const isChunkError = (err) =>
  /dynamically imported module|importing a module script failed|ChunkLoadError|Loading chunk|Failed to fetch dynamically/i.test(
    `${err?.name ?? ""} ${err?.message ?? ""}`,
  );

/**
 * React.lazy with one retry. After a new deploy an open tab can still point at chunk files that no
 * longer exist, and a flaky connection can drop a download; a second attempt fixes the second case,
 * and the error boundary offers a reload for the first.
 */
export function lazyRetry(factory, delayMs = 500) {
  return lazy(() => factory().catch(() => new Promise((resolve) => setTimeout(resolve, delayMs)).then(factory)));
}
