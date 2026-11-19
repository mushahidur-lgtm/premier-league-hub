/** Builders for synthetic *test inputs*. They live in tests only and are never shipped in the app. */
export const NOW = Date.UTC(2025, 0, 15, 12, 0, 0);
export const hoursAgo = (h) => new Date(NOW - h * 3600e3);

export function raw(over = {}) {
  return {
    id: over.link ?? "id",
    title: "Arsenal beat Spurs 2-0",
    link: "https://www.bbc.co.uk/sport/football/1",
    date: hoursAgo(2),
    image: null,
    excerpt: "",
    author: "",
    outlet: "bbc",
    source: "BBC Sport",
    clubs: ["arsenal"],
    also: [],
    ...over,
  };
}

export function espnEvent(over = {}) {
  const { homeScore = "2", awayScore = "1", state = "post", statusName = "STATUS_FULL_TIME", ...rest } = over;
  return {
    id: "e1",
    date: "2025-01-10T20:00Z",
    league: { slug: "eng.1" },
    competitions: [
      {
        status: { type: { state, completed: state === "post", name: statusName, shortDetail: "FT" } },
        venue: { fullName: "Emirates Stadium", address: { city: "London" } },
        competitors: [
          {
            homeAway: "home",
            score: homeScore,
            team: { id: "359", displayName: "Arsenal", shortDisplayName: "Arsenal", abbreviation: "ARS" },
          },
          {
            homeAway: "away",
            score: awayScore,
            team: { id: "367", displayName: "Spurs", shortDisplayName: "Spurs", abbreviation: "TOT" },
          },
        ],
      },
    ],
    ...rest,
  };
}
