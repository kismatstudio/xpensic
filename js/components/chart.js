// Lightweight, hand-rolled SVG bar chart. No external library — keeps the
// page small and avoids a chart.js dependency for what is essentially a
// sorted horizontal bar list with a single series.
//
// Renders into a host element. Returns nothing.

/**
 * @param {HTMLElement} host
 * @param {object} opts
 * @param {Array<{label: string, value: number, color?: string}>} opts.data
 * @param {string} [opts.valuePrefix]  — prepended to value labels (e.g. "₹")
 * @param {string} [opts.emptyText]    — shown when data is empty
 */
export function renderBarChart(host, opts) {
  const data = (opts.data || []).slice();
  // Wipe the host so repeated calls don't stack children.
  host.innerHTML = "";

  if (data.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted chart-empty";
    empty.textContent = opts.emptyText || "No data to display.";
    host.appendChild(empty);
    return;
  }

  // Sort descending by value so the biggest slice is on top.
  data.sort((a, b) => b.value - a.value);

  // Compute the chart geometry. Fixed row height + gap; total height grows
  // with the number of items.
  const ROW = 22;
  const GAP = 8;
  const LABEL_W = 110;     // left-side label column
  const VALUE_W = 80;      // right-side value column
  const PADDING = 4;
  const width = 520;
  const height = data.length * (ROW + GAP) - GAP + PADDING * 2;
  const max = Math.max(...data.map((d) => d.value), 1);
  // bar area = total width minus label and value columns
  const barAreaX = LABEL_W + 8;
  const barAreaW = width - LABEL_W - VALUE_W - 8;

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "chart-svg");
  svg.setAttribute("role", "img");

  data.forEach((d, i) => {
    const y = PADDING + i * (ROW + GAP);
    const w = Math.max(2, (d.value / max) * barAreaW); // min 2px so 0 values still show

    // Label on the left.
    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", LABEL_W);
    label.setAttribute("y", y + ROW / 2 + 4);
    label.setAttribute("class", "chart-svg__label");
    label.setAttribute("text-anchor", "end");
    label.textContent = d.label;
    svg.appendChild(label);

    // Track (background of the bar).
    const track = document.createElementNS(ns, "rect");
    track.setAttribute("x", barAreaX);
    track.setAttribute("y", y);
    track.setAttribute("width", barAreaW);
    track.setAttribute("height", ROW);
    track.setAttribute("rx", 4);
    track.setAttribute("class", "chart-svg__track");
    svg.appendChild(track);

    // Filled portion.
    const bar = document.createElementNS(ns, "rect");
    bar.setAttribute("x", barAreaX);
    bar.setAttribute("y", y);
    bar.setAttribute("width", w);
    bar.setAttribute("height", ROW);
    bar.setAttribute("rx", 4);
    bar.setAttribute("fill", d.color || "var(--color-primary)");
    svg.appendChild(bar);

    // Value on the right.
    const value = document.createElementNS(ns, "text");
    value.setAttribute("x", barAreaX + barAreaW + 8);
    value.setAttribute("y", y + ROW / 2 + 4);
    value.setAttribute("class", "chart-svg__value");
    value.textContent = `${opts.valuePrefix || ""}${formatNum(d.value)}`;
    svg.appendChild(value);
  });

  host.appendChild(svg);
}

// Format a number with Indian digit grouping, no fractional part.
function formatNum(n) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
}
