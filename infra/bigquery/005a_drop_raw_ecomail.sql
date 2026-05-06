-- 005a_drop_raw_ecomail.sql
-- One-time migration: drop the original draft raw_ecomail_* tables that don't
-- match the actual Ecomail API field names, so 005_create_raw_ecomail.sql can
-- recreate them with the correct schema.
--
-- Safe ONLY because the tables are empty. Verify with:
--   SELECT 'campaigns'   AS t, COUNT(*) FROM `oneeighty-warehouse.raw.raw_ecomail_campaigns`   WHERE DATE(sent_at)      <= CURRENT_DATE() UNION ALL
--   SELECT 'automations' AS t, COUNT(*) FROM `oneeighty-warehouse.raw.raw_ecomail_automations` WHERE snapshot_date      <= CURRENT_DATE() UNION ALL
--   SELECT 'subscribers' AS t, COUNT(*) FROM `oneeighty-warehouse.raw.raw_ecomail_subscribers` WHERE snapshot_date      <= CURRENT_DATE();
-- Each must return 0. If any > 0, STOP and decide whether to keep that data.

DROP TABLE `oneeighty-warehouse.raw.raw_ecomail_campaigns`;
DROP TABLE `oneeighty-warehouse.raw.raw_ecomail_automations`;
DROP TABLE `oneeighty-warehouse.raw.raw_ecomail_subscribers`;

-- After this, run 005_create_raw_ecomail.sql.
-- Note: new lists table is named `raw_ecomail_lists` (not `raw_ecomail_subscribers`)
-- to align with Ecomail's terminology. The old name is gone; nothing references it yet.
