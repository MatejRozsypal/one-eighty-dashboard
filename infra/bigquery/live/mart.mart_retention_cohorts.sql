CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_retention_cohorts` AS
SELECT
  client_id,
  cohort_month,
  entry_class,
  is_early,
  LOGICAL_OR(classes_configured) AS classes_configured,
  SUM(n_customer) AS n_customer,
  SUM(m30) AS m30, SUM(m60) AS m60, SUM(m90) AS m90, SUM(m180) AS m180, SUM(m365) AS m365,
  SUM(r30) AS r30, SUM(r60) AS r60, SUM(r90) AS r90, SUM(r180) AS r180, SUM(r365) AS r365,
  SUM(u30) AS u30, SUM(u60) AS u60, SUM(u90) AS u90, SUM(u180) AS u180, SUM(u365) AS u365,
  SUM(m23_180) AS m23_180,
  SUM(r23_180) AS r23_180,
  ANY_VALUE(cutoff_date) AS cutoff_date,
  ANY_VALUE(data_start_date) AS data_start_date,
  ANY_VALUE(history_guard_days) AS history_guard_days,
  COUNTIF(has_unmatched_line) AS n_unmatched,
  MAX(refreshed_at) AS refreshed_at
FROM `oneeighty-warehouse.mart.rpt_customer_entry`
GROUP BY client_id, cohort_month, entry_class, is_early;
