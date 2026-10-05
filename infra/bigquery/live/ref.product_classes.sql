CREATE TABLE `oneeighty-warehouse.ref.product_classes`
(
  client_id STRING NOT NULL,
  match_type STRING NOT NULL OPTIONS(description="code | code_base | code_prefix | name_prefix | name_regex | default"),
  pattern STRING NOT NULL OPTIONS(description="Value compared with the line code, code base or name. '*' for default."),
  line_class STRING NOT NULL OPTIONS(description="discovery | sample | full | bundle | gift_set | accessory | other"),
  counts_as_full BOOL NOT NULL OPTIONS(description="TRUE for full-size products and packs of them (full, bundle)."),
  priority INT64 NOT NULL OPTIONS(description="Lower wins when several rules match a line."),
  valid_from DATE OPTIONS(description="Rule applies to orders on or after this date. NULL = always."),
  valid_to DATE OPTIONS(description="Rule applies to orders before this date. NULL = always."),
  label STRING,
  note STRING,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
CLUSTER BY client_id
OPTIONS(
  description="Per-client order line classes for retention (entry class, upgrade to full size). Line code: Shoptet item_code (code_base = part before '/'), Shopify sku, WooCommerce sku else variation_id else product_id. The matching rule with the lowest priority wins; a line matching only 'default' or no rule is unclassified (ops.v_unclassified_products). Migration 257."
);
