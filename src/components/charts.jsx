/**
 * Hand-drawn SVG charts (no chart library). Rules from the data-visualisation guidance:
 *   - one series = one hue; the highlighted bar differs in colour *and* is labelled, never colour alone
 *   - lines: up to four series in a validated categorical order (checked on the site's surface), each with
 *     its own marker shape and a direct label at the line's end, plus a legend and a table view
 *   - text is ink, never the series colour; thin marks; recessive grid; hover titles on every mark
 */
import { useEffect, useId, useRef, useState } from "react";

/**
 * The rendered width of a wrapper, so a chart's viewBox matches real pixels and text keeps its size on a
 * phone and on a wide screen (a fixed viewBox would scale 13 px text to 7 px or 23 px).
 */
function useWidth(initial = 640) {
  const ref = useRef(/** @type {HTMLDivElement | null} */ (null));
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Categorical order validated on #fafbf8 (scripts/validate_palette.js): blue, orange, aqua, yellow. */
export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"];
const MARKERS = ["circle", "square", "triangle", "diamond"];
const INK = "#14201b";
const MUTED = "#4f5c55";
const GRID = "#d5ddd8";

/** A marker shape centred on (x, y). */
export function Marker({ shape, x, y, r = 4.5, color, title }) {
  const common = { fill: color, stroke: "#fafbf8", strokeWidth: 1.5 };
  const t = title ? <title>{title}</title> : null;
  if (shape === "square")
    return (
      <rect x={x - r} y={y - r} width={r * 2} height={r * 2} rx={1} {...common}>
        {t}
      </rect>
    );
  if (shape === "triangle")
    return (
      <polygon points={`${x},${y - r * 1.2} ${x + r * 1.1},${y + r * 0.8} ${x - r * 1.1},${y + r * 0.8}`} {...common}>
        {t}
      </polygon>
    );
  if (shape === "diamond")
    return (
      <polygon
        points={`${x},${y - r * 1.25} ${x + r * 1.25},${y} ${x},${y + r * 1.25} ${x - r * 1.25},${y}`}
        {...common}
      >
        {t}
      </polygon>
    );
  return (
    <circle cx={x} cy={y} r={r} {...common}>
      {t}
    </circle>
  );
}

/** A small swatch with the series' marker, for legends. */
export function SeriesKey({ i }) {
  return (
    <svg aria-hidden="true" width="22" height="12" className="inline-block shrink-0 align-middle">
      <line x1="1" y1="6" x2="21" y2="6" stroke={SERIES[i]} strokeWidth="2" />
      <Marker shape={MARKERS[i]} x={11} y={6} r={4} color={SERIES[i]} />
    </svg>
  );
}

/**
 * Horizontal bars, best first. `rows`: { key, label, value (number), display (text), highlight }.
 * Bars start at zero; the highlighted row is drawn in ink with a bold name (two cues, not colour alone).
 */
export function BarChart({ rows, summary, unit = "" }) {
  const [ref, width] = useWidth();
  const max = Math.max(...rows.map((r) => r.value), 0) || 1;
  const rowH = 24;
  const labelW = width < 420 ? 92 : 112;
  const valueW = 96;
  const plotW = width - labelW - valueW;
  const height = rows.length * rowH + 4;
  return (
    <div ref={ref} className="w-full max-w-3xl">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label={summary}
        className="block"
      >
        <line x1={labelW} y1={0} x2={labelW} y2={height} stroke={GRID} />
        {rows.map((r, i) => {
          const y = i * rowH + 4;
          const w = Math.max(2, (r.value / max) * plotW);
          const color = r.highlight ? INK : SERIES[0];
          return (
            <g key={r.key}>
              <title>{`${r.label}: ${r.display}${unit}${r.highlight ? " (selected)" : ""}`}</title>
              <text
                x={labelW - 8}
                y={y + rowH / 2 + 1}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize="13"
                fontWeight={r.highlight ? 700 : 400}
                fill={INK}
              >
                {r.label}
              </text>
              <rect x={labelW} y={y + 3} width={w} height={rowH - 8} rx={3} fill={color} />
              <text
                x={labelW + w + 6}
                y={y + rowH / 2 + 1}
                dominantBaseline="middle"
                fontSize="13"
                fontWeight={r.highlight ? 700 : 400}
                fill={INK}
              >
                {r.display}
                {unit}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * Lines over gameweeks. `series`: { key, label, short, points: [{ x, y, text }] } (at most four).
 * `invert` puts the smallest y at the top (league position). Direct labels sit at each line's end.
 */
export function LineChart({ series, xs, yMin, yMax, invert = false, summary, yLabel, yTicks }) {
  const id = useId();
  const [ref, width] = useWidth();
  const height = width < 420 ? 260 : 320;
  const m = { top: 30, right: 52, bottom: 44, left: 36 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;
  const x = (v) => m.left + (xs.length > 1 ? ((v - xs[0]) / (xs.at(-1) - xs[0])) * plotW : plotW / 2);
  const span = yMax - yMin || 1;
  const y = (v) => m.top + (invert ? (v - yMin) / span : (yMax - v) / span) * plotH;
  // End labels, nudged apart so they never overlap.
  const ends = series
    .map((s, i) => ({ i, s, last: s.points.at(-1) }))
    .filter((e) => e.last)
    .map((e) => ({ ...e, ly: y(e.last.y) }))
    .sort((a, b) => a.ly - b.ly);
  for (let k = 1; k < ends.length; k++) if (ends[k].ly - ends[k - 1].ly < 14) ends[k].ly = ends[k - 1].ly + 14;
  return (
    <div ref={ref} className="w-full max-w-4xl">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-labelledby={`${id}-t`}
        className="block"
      >
        <title id={`${id}-t`}>{summary}</title>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={m.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize="12" fill={MUTED}>
              {t}
            </text>
          </g>
        ))}
        {xs
          // At most one label per ~36 px, always keeping the latest gameweek.
          .filter((_, i) => i === xs.length - 1 || i % Math.max(1, Math.ceil((xs.length * 36) / plotW)) === 0)
          .map((v) => (
            <text key={v} x={x(v)} y={height - m.bottom + 18} textAnchor="middle" fontSize="12" fill={MUTED}>
              {v}
            </text>
          ))}
        <text x={m.left + plotW / 2} y={height - 4} textAnchor="middle" fontSize="12" fill={MUTED}>
          Gameweek
        </text>
        <text x={m.left - 6} y={12} textAnchor="start" fontSize="12" fill={MUTED}>
          {yLabel}
        </text>
        {series.map((s, i) => (
          <g key={s.key}>
            <polyline
              points={s.points.map((p) => `${x(p.x)},${y(p.y)}`).join(" ")}
              fill="none"
              stroke={SERIES[i]}
              strokeWidth={2}
              strokeLinejoin="round"
            />
            {s.points.map((p) => (
              <Marker
                key={p.x}
                shape={MARKERS[i]}
                x={x(p.x)}
                y={y(p.y)}
                color={SERIES[i]}
                title={`${s.label}, gameweek ${p.x}: ${p.text}`}
              />
            ))}
          </g>
        ))}
        {ends.map((e) => (
          <text
            key={e.s.key}
            x={x(e.last.x) + 9}
            y={e.ly}
            dominantBaseline="middle"
            fontSize="12"
            fontWeight={700}
            fill={INK}
          >
            {e.s.short}
          </text>
        ))}
      </svg>
    </div>
  );
}
