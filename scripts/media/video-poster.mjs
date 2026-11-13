/**
 * scripts/media/video-poster.mjs — PART V3: which poster a video lesson shows
 * before play. Hook for a future TEAM column `thumbnail_link` (not in
 * data/master/columns.json yet): when a lesson row has a Drive file in it, that
 * picture wins; otherwise the frame grabbed ~10 % in (`poster_key`, a WebP next
 * to the video key on R2). No poster = null (the player shows none).
 */
import { driveIds } from '../catalogue/sheets-map.mjs';

/** → { from: 'team', drive_file_id } | { from: 'frame', key } | null. Pure. */
export function posterSource(row, entry) {
  const team = driveIds(row && row.thumbnail_link)[0];
  if (team) return { from: 'team', drive_file_id: team };
  if (entry && entry.poster_key) return { from: 'frame', key: entry.poster_key };
  return null;
}
