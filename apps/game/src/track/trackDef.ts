export interface TrackDef {
  /** Closed control polygon (x, z); the first point is the start line. */
  controlPoints: [number, number][];
  width: number;
  /** Item box rows as fractions of the track length. */
  itemBoxRows: number[];
  /** Lateral offsets of the boxes in each row (positive = right). */
  itemBoxLaterals: number[];
  /** Boost pads: `s` as a fraction of the lap, `lateral` in metres (positive = right). */
  boostPads?: { s: number; lateral: number }[];
}

export const TRACK_V1: TrackDef = {
  controlPoints: [
    [0, -40], [0, 0], [0, 40], [0, 62], [12, 84], [34, 92], [55, 82],
    [62, 62], [48, 34], [70, 8], [56, -22], [44, -60], [24, -84], [0, -76],
  ],
  width: 12,
  itemBoxRows: [0.3, 0.7],
  itemBoxLaterals: [-4.5, -1.5, 1.5, 4.5],
  // Start straight past the grid (centre), the right hairpin's exit and the last corner's exit (both on
  // the outside of the exit, where a wide line ends up).
  boostPads: [
    { s: 0.08, lateral: 0 },
    { s: 0.655, lateral: -2.5 },
    { s: 0.945, lateral: -2.5 },
  ],
};
