-- =============================================================================
-- 280b_clickup_lists_rawbark.sql
-- Creative suite (package cs1): register RawBark's creative lists.
--
-- Why
--   ref.clickup_lists had no rawbark rows, so the hourly ClickUp sync never
--   read RawBark's Meta ads pipeline, Concept list or Persona Bank, although
--   all three exist (folder Client Success / Delivery / Rawbark, 1200620000007594)
--   and on 2026-10-08 held about 20 concepts, 16 personas and at least one ad
--   task in status `live`.
--
-- Change
--   INSERT three rows. With 280 deployed, the concept link is the ad pipeline
--   field `RAW: Concept` (657cd461-...) and the persona link is the concept
--   list field `RAW: Persona` (8281e105-...), both derived from where they
--   point, so no ref.clickup_field_map row is needed. The template copies on
--   the same lists (`Concept` aimed at Ethia's and Manami's concept lists,
--   `Persona` aimed at Manami's Persona Bank) are ignored and reported.
--
-- Not done here
--   Dobias has no ad pipeline, concept or persona list in ClickUp (its folder
--   holds Maui Content, Assets, Reporting, Flows). Nothing to register.
--   RawBark still has no Meta connection (OWNER_TODO_2026-10.md section C), so
--   concepts and personas will show, ad performance will not.
--
-- Idempotent: rows are inserted only when absent.
-- Deploy after 280. Effective at the next hourly sync (:45 UTC).
-- =============================================================================
INSERT INTO `oneeighty-warehouse.ref.clickup_lists` (client_id, list_kind, list_id, folder_id, active)
SELECT s.client_id, s.list_kind, s.list_id, s.folder_id, TRUE
FROM UNNEST([
  STRUCT('rawbark' AS client_id, 'ad_pipeline' AS list_kind, '1200620000012321' AS list_id, '1200620000007594' AS folder_id),
  STRUCT('rawbark', 'concepts', '1200620000012320', '1200620000007594'),
  STRUCT('rawbark', 'personas', '1200620000012322', '1200620000007594')
]) s
WHERE NOT EXISTS (
  SELECT 1 FROM `oneeighty-warehouse.ref.clickup_lists` l
  WHERE l.client_id = s.client_id AND l.list_kind = s.list_kind);
