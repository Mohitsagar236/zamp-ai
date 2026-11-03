/** Reconstruct horizontal text from PDF coordinates, independent of drawing order.
 * Large gaps remain column separators. Rotated text is excluded from this path.
 */
export interface PositionedText {
  str: string;
  transform: number[];
  width: number;
}
export function layoutText(items: PositionedText[]): string {
  const rows: { y: number; height: number; cells: PositionedText[] }[] = [];
  for (const item of [...items].sort(
    (a, b) =>
      b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4],
  )) {
    if (!item.str.trim()) continue;
    const height = Math.abs(item.transform[3]) || 10;
    const y = item.transform[5];
    const row = rows.find(
      (candidate) =>
        Math.abs(candidate.y - y) <= Math.min(candidate.height, height) * 0.25,
    );
    if (row) row.cells.push(item);
    else rows.push({ y, height, cells: [item] });
  }
  return rows
    .map((row) => {
      let right: number | undefined;
      return row.cells
        .sort((a, b) => a.transform[4] - b.transform[4])
        .map((item) => {
          const gap = right === undefined ? 0 : item.transform[4] - right;
          right = item.transform[4] + item.width;
          return (
            (gap > row.height * 1.5
              ? "  "
              : gap > row.height * 0.12
                ? " "
                : "") + item.str
          );
        })
        .join("");
    })
    .join("\n");
}
