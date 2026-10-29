export interface TrackDef {
  /** Closed control polygon (x, z); the first point is the start line. */
  controlPoints: [number, number][];
  width: number;
  /** Item box rows as fractions of the track length. */
  itemBoxRows: number[];
  /** Lateral offsets of the boxes in each row (positive = right). */
  itemBoxLaterals: number[];
}

export const TRACK_V1: TrackDef = {
  controlPoints: [
    [0, -40], [0, 0], [0, 40], [0, 62], [12, 84], [34, 92], [55, 82],
    [62, 62], [48, 34], [70, 8], [56, -22], [44, -60], [24, -84], [0, -76],
  ],
  width: 12,
  itemBoxRows: [0.3, 0.7],
  itemBoxLaterals: [-4.5, -1.5, 1.5, 4.5],
};
