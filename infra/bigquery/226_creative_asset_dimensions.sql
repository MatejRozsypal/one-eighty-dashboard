-- 226_creative_asset_dimensions.sql
-- Creative Engine: record the shape of each creative.
--
-- ── Why the pixels are stored ─────────────────────────────────────────────
-- The detail panel drew every creative inside a fixed 4:5 box with
-- `object-fit: cover`. Meta's vertical formats are 9:16, so roughly 28% of every
-- video — the top and bottom of it — was cut off before it reached the screen.
-- The files were never cropped: the mirrored mp4s are 720x1280 and their
-- posters 360x640, both exactly 9:16. Only the CSS was.
--
-- Fixing that means sizing the box to the creative rather than the creative to
-- the box, and to do it without the panel reflowing under the reader the shape
-- has to be known before the media loads. On a `preload="none"` video the
-- browser does not report it until somebody presses play.
--
-- So the job reads it once, at mirror time, from the file it already has in
-- memory: `tkhd` for video, the image header for everything else. Where a video
-- has no reachable source the poster supplies it, because a poster always
-- shares its video's aspect.
--
-- Nullable, because a row written before this existed has no answer and a
-- guessed 4:5 is exactly the bug this is undoing. The UI falls back to letting
-- the browser size the media when they are absent.
--
-- Run order: any time. Re-run `creative_assets_job.py <client> --all` after it
-- to fill the existing rows.

ALTER TABLE `oneeighty-warehouse.raw.raw_meta_ad_creatives`
  ADD COLUMN IF NOT EXISTS asset_width  INT64
    OPTIONS (description = "Pixel width of the creative as served. Null for rows mirrored before 2026-09-09."),
  ADD COLUMN IF NOT EXISTS asset_height INT64
    OPTIONS (description = "Pixel height of the creative as served. Null for rows mirrored before 2026-09-09.");
