# Markets page: platform field research (Shopify, Shoptet, WooCommerce, ad platforms)

Researched 2026-10-15. Sources are cited inline. Items marked VERIFIED were read in official docs or source code this session. Items marked UNVERIFIED are from memory or secondary sources and must be checked on a live order before the BigQuery model relies on them.

## Part 1. Order-level matrix

Legend: S = Shopify (Admin GraphQL), T = Shoptet (REST API, api.docs.shoptet.com), W = WooCommerce (REST v3 / HPOS tables).

### 1.1 Market keys

| Input | Shopify | Shoptet | WooCommerce | Caveat |
|---|---|---|---|---|
| Shipping country | `Order.shippingAddress.countryCodeV2` (ISO alpha-2). Null for digital / non-shipping orders. | `order.deliveryAddress.countryCode` (ISO alpha-2, nullable). `deliveryAddress` itself is nullable; `addressesEqual` flag says it equals billing. Pickup point country: `order.shippingDetails.countryCode` (needs `include=shippingDetails`). | `shipping.country` (ISO alpha-2). HPOS: `wc_order_addresses` row with `address_type='shipping'`, column `country`. | Woo shipping address is often empty for virtual or local pickup orders; fall back to billing. Shoptet `deliveryAddress` null when same as billing on some old orders, test with `addressesEqual`. |
| Billing country | `Order.billingAddress.countryCodeV2` (null if none given at checkout). | `order.billingAddress.countryCode`. | `billing.country`. HPOS `wc_order_addresses.address_type='billing'`. | Billing country decides EU VAT (OSS) for digital goods; shipping country decides it for physical goods. Use shipping as the market key, billing only as fallback. |
| Order currency | `Order.presentmentCurrencyCode` (customer paid in this) vs `Order.currencyCode` (shop currency). Every `*Set` field is a MoneyBag with `shopMoney` and `presentmentMoney`. | `order.price.currencyCode` (currency of the order). `order.price.exchangeRate` and `invoicingExchangeRate` = rate to the shop default currency, frozen at order creation. | `order.currency` (ISO). Totals are stored in this currency, NOT converted. | See gotchas 1 to 4. |
| Exchange rate at order time | Implicit in the MoneyBag pair (shop vs presentment). `OrderTransaction.settlementCurrencyRate` for Shopify Payments settlement. | `price.exchangeRate` (string, 8 decimals, e.g. "1.04568087"). Doc: refers to the shop default currency at the instant of order creation; if the shop later changes its default currency the value still refers to the ORIGINAL currency. | Core: none. Plugin meta: WOOCS `_woocs_order_rate` + `_woocs_order_base_currency`; CURCY `wmc_order_info[<CODE>].rate` (+ `is_main`); Aelia and WCML: see 1.1a. | Shoptet direction of the rate depends on `settings.exchangeRateFlip` from `GET /api/eshop`. Test with one EUR order before dividing or multiplying. |
| Storefront domain / market | NO market field on Order (confirmed by Shopify staff: Shopify community thread "Order/market matching"). Proxy: map `shippingAddress.countryCodeV2` to `markets` (fragment on `MarketRegionCountry`). ShopifyQL `sales` dataset DOES expose `market` and `markets` dimensions (VERIFIED), also `shipping_country_code`, `billing_country_code`, `order_checkout_currency`. | Order has `salesChannelGuid` (nullable) plus `GET /api/sales-channels` returns per channel `currencies[]` and `languages[]` (code, locale, isDefault). Order also has `language` (only when module foreignLanguages is active). Domain: only the shop-level `GET /api/eshop` -> `contactInformation.url`; `order.referer` is the page the user came from, not the storefront. | No native field. WPML: language stored in order meta (key name disputed in community: `wpml_language`, `wpml_languages`, `_order_wpml_language`, UNVERIFIED, inspect `wc_orders_meta`). Domain per language: derive from `order.meta_data` or `created_via`, or from the site URL if each country is a separate WP install. | Shopify `Order.customerLocale` exists (format like `fr-FR`, read-only, empty for API-created orders). It is language, not market. |
| Customer language | `Order.customerLocale` (string). | `order.language` | WPML meta (see above) | Language is a weak market key (Czech speakers live in SK and vice versa). |

#### 1.1a Woo multi-currency plugins: where the base-currency value lives

| Plugin | What is stored on the order | Source | Status |
|---|---|---|---|
| WOOCS (PluginUs, free) | Order total is in the order currency. Meta `_woocs_order_rate` (rate used), `_woocs_order_base_currency` (shop default), `_woocs_order_currency_changed_mannualy` (typo is in the code). Written in the `woocommerce_thankyou` hook, so an order whose customer never returns to the thank-you page (off-site payment) may have NO rate. Back-conversion in code: `back_convert(value, rate)`. | plugin source classes/woocs.php lines ~3046 and ~4289: https://plugins.svn.wordpress.org/woocommerce-currency-switcher/trunk/classes/woocs.php | VERIFIED in code |
| CURCY (VillaTheme `woo-multi-currency`) | Order meta `wmc_order_info` = array keyed by currency code: `[code] => {rate, decimals, is_main, ...}`. Base-currency value = `(order_total - total_refunded) / wmc_order_info[order_currency].rate` (their own admin code does exactly this). Orders created while the plugin was off have no `wmc_order_info`; orders created through the REST API often get no currency set at all. | https://plugins.svn.wordpress.org/woo-multi-currency/trunk/admin/order.php (lines ~90 to 160) and admin/analytics.php | VERIFIED in code |
| Aelia Currency Switcher | Stores exchange rate on each order and on refunds (Zorem doc confirms rate is per order). Exact meta keys (`_order_exchange_rate`, `_base_currency`, `_order_total_base_currency` and similar) NOT confirmed. | https://docs.zorem.com/docs/sales-report-by-country-for-woocommerce/compatibility/ | UNVERIFIED keys |
| WPML + WCML multicurrency | Order stored in the customer currency; WCML shows a currency filter in Analytics. Order language meta key disputed. Premium plugin, source not readable. | https://wpml.org/forums/topic/meta-key-when-creating-an-order-in-woocommerce | UNVERIFIED keys |

Practical rule for the model: for Woo, store `order.currency` and `total` as-is, and compute the shop-currency value only from a rate persisted on the order. If no persisted rate exists, fall back to a dated FX table (e.g. CNB daily rates) and flag the row `fx_source='table'`.

### 1.2 Gross sales, line prices, regular vs sale price

| Input | Shopify | Shoptet | WooCommerce | Caveat |
|---|---|---|---|---|
| Line unit price at order time | `LineItem.originalUnitPriceSet` (before discounts, both currencies). `LineItem.originalTotalSet` = unit x quantity before discounts. | `items[].unitPrice.{withVat,withoutVat,vat,vatRate}` and `items[].itemPrice` (total of the row). | `line_items[].price` (unit price actually charged) and `subtotal` (line before coupons, excl. tax), `total` (after coupons, excl. tax). | Woo `subtotal` is already the SALE price if the product was on sale. S `discountedUnitPriceSet` is only approximate and excludes order-level and code discounts. |
| Compare-at / regular price at order time | NOT on the order. `ProductVariant.compareAtPrice` is the CURRENT value in default shop currency only; market prices live in `ProductVariant.contextualPricing(context:{country})` and price lists. Only workable approach: snapshot variant `price`/`compareAtPrice` nightly into BigQuery and join by `variant_id` + date. | NOT on the order item (only `unitPrice`). Product side: variant `price` (current), `commonPrice` (the crossed-out standard price), `actionPrice.{price,fromDate,toDate}` (sale window), `perPricelistPrices[]`, `includingVat`. | NOT on the order. Product side: `regular_price`, `sale_price`, `price`, `on_sale`, `date_on_sale_from/to`. | The "markdown" (compare-at minus sold price) cannot be reconstructed from orders alone on any of the three. Snapshot catalogue prices daily or accept "discount vs list at order date" is unknown. |
| Gross sales (before discounts, excl. shipping) | ShopifyQL `gross_sales`. From order: sum over `lineItems.originalTotalSet`. Order level: `subtotalPriceSet` is AFTER discounts; `totalDiscountsSet` added back gives pre-discount. | Sum of `items[]` where `itemType` in (`product`, `bazar`, `service`, `gift`, `product-set-item`, ...) of `itemPrice` (decide with/without VAT by `vatMode`/`vatPayer`). | Sum of `line_items[].subtotal` (excl. tax) or `subtotal + subtotal_tax` (incl.). | See tax section: Shopify and Woo decide inclusive/exclusive per shop setting; Shoptet gives both `withVat` and `withoutVat` always. |
| Order grand total | `totalPriceSet` (before returns), `currentTotalPriceSet` (after returns), `originalTotalPriceSet` (at creation). | `price.withVat`, `price.withoutVat`, `price.vat`, `price.toPay` (toPay can be lower for partial payments), `price.partialPaymentAmount`. | `total` (incl. tax), `total_tax`. | Use the "current" total on Shopify when you want net of edits and returns. |

### 1.3 Discounts split (code / automatic / manual)

| Input | Shopify | Shoptet | WooCommerce | Caveat |
|---|---|---|---|---|
| Discount sources | `Order.discountApplications` (interface DiscountApplication: `allocationMethod`, `index`, `targetSelection`, `targetType`, `value`). Concrete types by `__typename`: `DiscountCodeApplication` (adds `code`), `AutomaticDiscountApplication` (adds `title`), `ManualDiscountApplication` (title, description), `ScriptDiscountApplication` (legacy Scripts). Type names beyond DiscountCodeApplication were not on the fetched page, UNVERIFIED but stable for years. | No dedicated discount object. Discounts are order ITEMS with `itemType` = `discount-coupon` (coupon) or `volume-discount` (quantity discount); negative prices. Gift certificates are `gift-certificate`. Coupon code is not a separate field (UNVERIFIED, check `name`). Admin manual discounts show as `generic-item` with negative price or as a line `discount` percent in XML export. | `coupon_lines[]`: `code`, `discount` (excl. tax), `discount_tax`, `discount_type`, `nominal_amount`, `free_shipping`. Order `discount_total` + `discount_tax` = coupons only. | Woo automatic discounts from plugins (dynamic pricing, BOGO) usually appear as a lowered line price (`subtotal` already reduced) or as NEGATIVE `fee_lines[]`; there is no type flag, so classify by fee name. |
| Amount actually discounted per line | `LineItem.discountAllocations[]` (amount `allocatedAmountSet` + the application). A DiscountApplication is only the intent; the money is on the allocation. Also `ShippingLine.discountAllocations` for free-shipping style discounts. | Row `itemPrice` of the discount item; negative. | `line_items[].subtotal - total` (coupon share per line); order level `discount_total`. | Shopify: `LineItem.discountedTotalSet` excludes order-level and code-based discounts unless `withCodeDiscounts: true`. Shopify `LineItem.quantity` includes refunded units; use `currentQuantity` for live units. |
| Totals | `totalDiscountsSet`, `cartDiscountAmountSet` (order-level only). ShopifyQL: `discounts`, `line_item_discounts`, `order_level_discounts`, `shipping_charge_discounts`, dimensions `discount_code`, `discount_method`, `discount_type`, `discount_class`. | Sum of negative items. | `discount_total` | ShopifyQL `discount_method` gives code vs automatic without parsing applications. |
| Gift cards | `gift_card_discounts` metric (gift card payment is NOT a discount in revenue terms; it is a payment). | `gift-certificate` item type | plugin dependent | Exclude gift card redemption from discount totals. |

### 1.4 Shipping charged vs cost, free shipping

| Input | Shopify | Shoptet | WooCommerce | Caveat |
|---|---|---|---|---|
| Shipping charged | `Order.shippingLines[]`: `originalPriceSet` (before discounts), `discountedPriceSet` (after, incl. cart-level free shipping since API 2024-07), `currentDiscountedPriceSet` (after refunds). `Order.totalShippingPriceSet` = charged. Includes tax when `taxesIncluded`. | `items[]` with `itemType='shipping'` (VAT split in `itemPrice.vat`). Also `order.shippings[]` (method + `itemId`). | `shipping_lines[]`: `method_id`, `method_title`, `instance_id`, `total` (excl. tax), `total_tax`. Order `shipping_total`, `shipping_tax`. | Shoptet: payment fee (cash on delivery surcharge) is a SEPARATE item `itemType='billing'`; do not mix it into shipping. |
| Free shipping | shipping line price 0, or a discount allocated to the shipping line. | shipping item price 0 | `shipping_lines[].total == 0`; `method_id='free_shipping'` or coupon `free_shipping: true` | Keep a boolean `is_free_shipping` plus the carrier title. |
| Shipping COST to the merchant | NOT in the order. Shopify Shipping label purchases appear as Shopify Payments balance transactions of type `SHIPPING_LABEL`, `SHIPPING_LABEL_ADJUSTMENT*` (VERIFIED enum values) - but only for labels bought in Shopify. Carrier invoices (PPL, Zasilkovna, DPD) must come from a cost table. | NOT available. Shoptet shipments API (`/api/shipments/order/{code}`) has statuses only. Use a per-carrier rate card keyed by `shippingDetails.shippingCompanyCode` and country. | NOT in core. Zasilkovna/Packeta plugin meta has COD and weight but no cost. | Plan: a `shipping_cost_rules` table (client, carrier, country, weight band, price) and compute cost per order. State this as an ESTIMATE in the UI. |

### 1.5 Taxes, tax-inclusive pricing, VAT per country (EU OSS)

| Input | Shopify | Shoptet | WooCommerce | Caveat |
|---|---|---|---|---|
| Are prices tax inclusive | `Order.taxesIncluded` (boolean): if true subtotal and line prices include tax. | Both given: `price.withVat` and `price.withoutVat`; `vatPayer` (is the e-shop a VAT payer), `vatMode` (Normal / One Stop Shop / Mini One Stop Shop / Reverse charge / Outside the EU, VERIFIED code list). | `prices_include_tax` (boolean, per order). HPOS: `wc_order_operational_data.prices_include_tax`. | Mixed carts: a single shop can show incl. tax in CZ and excl. tax for B2B. Always read the per-order flag, never the shop setting. |
| Tax amounts | `Order.taxLines[]` (`title`, `rate`, `ratePercentage`, `priceSet`, `source`, `channelLiable`), `currentTaxLines` after returns. Per line: `LineItem.taxLines`, `ShippingLine.taxLines`. ShopifyQL `taxes`, `shipping_charge_taxes`, `tax_reversals`. | `price.vat`; per item `itemPrice.vat` and `vatRate`. Mixed rates: `itemPriceVatBreakdown[]` on non-product items. | `total_tax`, `cart_tax`, `shipping_tax`, `discount_tax`; `tax_lines[]` (`rate_code`, `rate_id`, `label`, `compound`, `tax_total`, `shipping_tax_total`); per line `taxes[]`. Analytics table `wc_order_tax_lookup`. | Rate code strings are free text; derive the VAT % from `rate_code` or from `total_tax / taxable amount`. |
| VAT rate per destination country (OSS) | `TaxLine.rate` per line already reflects destination rate when Markets/EU tax settings are configured. | Order VAT mode OSS is flagged by `vatMode`; shop-level `settings.oss` in `GET /api/eshop`; per-variant `ossVatLevels[]` = per-country rates (`countryCode`, `taxLevel`, `taxValue`). | OSS needs a tax plugin or manual rate rows per country; rate identified only by `tax_lines[].rate_code`. | For the P&L use NET of VAT revenue in the shop currency. Reporting gross incl. VAT inflates margin by 21% in CZ and by different rates elsewhere. |
| Reverse charge B2B | `taxExempt` on order and customer. | `billingAddress.vatId`, `vatIdValidationStatus` (`unverified`,`verified`,`waiting`). | needs plugin (e.g. EU VAT number) | Exempt orders have 0 tax and shipping-country rate is irrelevant. |

### 1.6 Payment method, COD detection, payment fees

| Input | Shopify | Shoptet | WooCommerce | Caveat |
|---|---|---|---|---|
| Payment method / gateway | `Order.paymentGatewayNames[]` (array!), `Order.transactions[].gateway` / `formattedGateway` / `paymentDetails` (union) / `manualPaymentGateway`. Multiple gateways per order are possible (gift card + card). | `order.paymentMethod.{guid,name}` plus `order.paymentMethods[]` (all methods). Operator type: `GET /api/payment-methods` -> `paymentType.{id,code,name}`. Billing method: `order.billingMethod.{id,name}` where id 1 = COD, 2 = wire transfer, 3 = cash, 4 = card (VERIFIED code list "Invoice billing methods"). | `payment_method` (gateway id, e.g. `cod`, `bacs`, `stripe`, `gopay`), `payment_method_title` (customer-facing text), `transaction_id`. | Never match on the title; titles are translated per language. Match on `payment_method` id. |
| COD detection | Shopify has no standard COD flag. Manual / "Cash on Delivery (COD)" custom payment method: `gateway` is a free-text name (docs do not define a `cash_on_delivery` value, VERIFIED absence). Rule: `manualPaymentGateway = true` AND name matches the client's custom COD name, or `paymentGatewayNames` contains it. Per-client mapping table needed. | `order.billingMethod.id == 1` (best), or `paymentMethod.name` contains "Dobirka". Plus a `billing` item exists (COD fee). | `payment_method == 'cod'` (core COD gateway). Czech COD plugins (Zasilkovna, PPL) use their own ids; map per client. | COD returns are a big hidden cost: store `is_cod` on the order and compare refusal rate by market. |
| Transaction / processing fees | Shopify Payments only: `OrderTransaction.fees[]` (`TransactionFee`: `amount`, `flatFee`, `rate`, `rateName`, `taxAmount`, `type`, VERIFIED). Authoritative: `ShopifyPaymentsAccount.balanceTransactions` -> `ShopifyPaymentsBalanceTransaction` fields `amount`, `fee`, `net`, `type`, `sourceOrderTransactionId`, `associatedOrder`, `associatedPayout`, `transactionDate`; needs `view_payouts` permission. Fee types include `CHARGE`, `REFUND`, `CHARGEBACK_FEE`, `CURRENCY_CONVERSION`, `SHIPPING_LABEL`, `REFERRAL_FEE` (VERIFIED enum list). Third-party gateways: no fees in Shopify. | NOT available in orders API. Optional `include=paymentTransactions` gives transaction id / price / status only. Shoptet Pay / Comgate / GoPay fees come from the gateway statements. Use a per-client fee-rate table (percent + fixed) per payment method. | Stripe gateway plugin: order meta `_stripe_fee`, `_stripe_net`, `_stripe_currency` (VERIFIED as constants in WC_Stripe_Helper; only populated for card payments, only for orders after plugin v4.0, request open for SEPA and others). PayPal, GoPay, Comgate: no standard meta, UNVERIFIED. | Fees are in the SETTLEMENT currency, not necessarily the order currency. Shopify `settlementCurrency` / `settlementCurrencyRate` on OrderTransaction. |

### 1.7 Refunds, returns, cancellations

| Input | Shopify | Shoptet | WooCommerce | Caveat |
|---|---|---|---|---|
| Refund records | `Order.refunds[]` -> `Refund`: `createdAt`, `processedAt`, `totalRefundedSet`, `refundLineItems`, `refundShippingLines`, `orderAdjustments`, `transactions`, `duties`, `return` (only if via returns flow). Order level: `totalRefundedSet`, `netPaymentSet`, `currentTotalPriceSet`. | `GET /api/credit-notes` and `/api/credit-notes/{code}` (a credit note is the refund document): `orderCode`, `invoiceCode`, `creationTime`, `price.*`, `items[]`, `restocked`, `billingAddress/deliveryAddress.countryCode`, `price.currencyCode` + `exchangeRate`. Order itself has NO refund field. | `refunds[]` on the order (`id`, `reason`, `total`, `total_tax`; NEGATIVE strings) and `GET /orders/{id}/refunds` with `line_items[]`, `amount`, `date_created`. Order `total` is NOT reduced by refunds. | Shopify: a Refund record does not prove money moved; check `transactions[].status`. Shoptet: only invoiced orders get credit notes; a cancelled order has no credit note, just a status. |
| Line level | `RefundLineItem` (`quantity`, `subtotalSet`, `totalTaxSet`, `restockType`). | credit note `items[]` with `unitPrice`, `itemPrice` | refund `line_items[]` with `quantity`, `subtotal`, `total`, `taxes` | Match refund lines back to order lines via `order_item_id` (Woo) or `code` (Shoptet). |
| Cancellations | `Order.cancelledAt`, `Order.cancelReason`. | `order.status.{id,name}` (system statuses are negative ids; custom statuses positive). `GET /api/eshop?include=orderStatuses` lists them with `markAsPaid`. A "cancelled" meaning is client-specific. | `status` = `cancelled`, `failed`, `refunded`, `trash` etc. | Shoptet status mapping table per client is mandatory. Roivenue treats only the exact Czech name "Vyrizena" as delivered, which breaks when a shop renames statuses (documented gotcha). |
| Return date vs sale date | `Refund.processedAt`; ShopifyQL `sales` has `is_sales_reversal`, `return_reason`, `refund_id`, `return_fees` and reversal metrics (`gross_sales_reversals`, etc.). | credit note `creationTime`, `taxDate` | refund `date_created` | Book returns on the RETURN date (cash view) and also provide an "attributed to original order month" view. |

### 1.8 Customer identity, new vs returning, customer country

| Input | Shopify | Shoptet | WooCommerce | Caveat |
|---|---|---|---|---|
| Customer key | `Order.customer.id` (null for guest checkouts), `Order.email`. | `order.customerGuid` (only if registered, nullable), `order.email`. | `customer_id` (0 for guests), `billing.email`. HPOS `wc_orders.billing_email`. Analytics `wc_customer_lookup.customer_id` (a separate id space). | Guests are common. Key the model on a lowercase, trimmed email hash with customer id as secondary. Shoptet list filter `GET /api/orders?email=` is exact match. |
| New vs returning | `Order.customerJourneySummary.customerOrderIndex` (position of this order in the customer's history, test orders excluded). ShopifyQL dimension `new_or_returning_customer`; metrics `new_customers`, `returning_customers`, `orders_first_time`, `orders_returning`. `Customer.numberOfOrders` is lifetime, not as-of order date. | Not provided; compute from your own warehouse by email / customerGuid ordered by `creationTime`. | `wc_order_stats.returning_customer` (tinyint, Analytics table) or compute from email. | Compute it yourself in BigQuery by first-order date per email across statuses that count as a sale. Also compute per market (a CZ customer first buying in SK is new to SK but not new to the brand). |
| Customer's country | There is NO country on `Customer`. Use `Customer.defaultAddress.countryCodeV2` or, better, the country of the first order's shipping address. `customers` query filter `country:` is a filter, not a field. | `GET /api/customers` has addresses; `GET /api/customers/regions` is a code list. In practice use the order address. | `wc_customer_lookup.country` (char 2) from the last known billing country; can drift. | Customers move between orders; assign the market per ORDER, not per customer. |
| Protected customer data | Orders older than 60 days need the "all orders" access; customer PII fields need protected-customer-data approval for public apps. | Needs token rights for customers/orders endpoints. | Application password / consumer key. | Mask email in dashboards; store the hash only. |

### 1.9 COGS per SKU

| Input | Shopify | Shoptet | WooCommerce | Caveat |
|---|---|---|---|---|
| Unit cost | `InventoryItem.unitCost` (`MoneyV2`, nullable, shop currency; needs `read_inventory` or `read_products`, and "View product costs" permission). Reach it via `ProductVariant.inventoryItem`. ShopifyQL: `cost_of_goods_sold`, `gross_profit`, `cost_is_recorded`, `net_sales_with_cost_recorded`. | Order item level snapshot: `items[].purchasePrice.{withVat,withoutVat,vat,vatRate}` (nullable) and the XML export tag `PURCHACE_PRICE` (sic) at order total. Product level: `variants[].prices.purchasePrice.{price,vatRate,includingVat}` (doc says "currently for preview only"). | Native Woo COGS (opt-in, leaves beta in Woo 10.0, Settings > Advanced > Features): product `cost_of_goods_sold.values[]`, `.total_value`; order `cost_of_goods_sold.total_value`; line `line_items[].cost_of_goods_sold.value` (frozen at order time; refunds return negative). Not in Analytics reports. Third-party plugins (WPFactory, SkyVerge, etc.) use their own meta. | Shopify unitCost is the CURRENT cost, not an order-time snapshot (ShopifyQL `cost_of_goods_sold` is computed from the cost at sale time). For BigQuery, snapshot `unitCost` daily. Shoptet purchase price may be excl. or incl. VAT (check `includingVat`); null cost means 100 percent margin in Roivenue's own connector (documented trap). Woo COGS: orders placed BEFORE the feature was enabled have no cost. |

## Part 2. Shoptet specifics

Docs: https://api.docs.shoptet.com/shoptet-api/openapi (OpenAPI bundle: https://api.docs.shoptet.com/_bundle/Shoptet%20API/openapi.json). All field paths below were read from the official spec (VERIFIED).

### 2.1 Order endpoints

- `GET /api/orders` (list, 50 per page max): filters `creationTimeFrom/To`, `changeTimeFrom/To`, `statusId`, `paymentMethodGuid`, `shippingGuid`, `customerGuid`, `email`, `sourceId`, `orderCodes` (up to 50). The LIST payload does NOT contain addresses, country, items or language. It has `price.{withVat,withoutVat,vat,toPay,currencyCode,exchangeRate,invoicingExchangeRate}`, `paid`, `status`, `source`, `shipping`, `paymentMethod`.
- `GET /api/orders/{code}` (detail) has everything in this document. Optional `include`: `notes,images,shippingDetails,stockLocation,surchargeParameters,paymentTransactions,productFlags`.
- `GET /api/orders/snapshot` (async, jsonlines gzip file) returns the FULL detail for every order. Use this for backfills; it avoids one call per order.
- Rate limits: max 50 concurrent connections per IP and 3 per token; also a leaky bucket (`X-RateLimit-Bucket-Filling`, `Retry-After`). HTTP 429 on excess. Order codes are strings, may contain letters.
- Related: `GET /api/credit-notes`, `/api/invoices`, `/api/proforma-invoices`, `GET /api/eshop` (currencies, languages when module active, `settings.oss`, `settings.exchangeRateFlip`, `activeModules`), `GET /api/sales-channels`, `GET /api/payment-methods`, `GET /api/shipping-methods`, `GET /api/orders/statuses`, `GET /api/orders/sources`.

### 2.2 Order JSON field paths used by the Markets page

| Need | Path |
|---|---|
| Order id / created | `data.order.code`, `guid`, `creationTime`, `changeTime` |
| Shipping country | `data.order.deliveryAddress.countryCode` (nullable object) |
| Billing country | `data.order.billingAddress.countryCode` |
| Pickup point country | `data.order.shippingDetails.countryCode` |
| Currency | `data.order.price.currencyCode` |
| Exchange rate (to shop default) | `data.order.price.exchangeRate`, `invoicingExchangeRate` |
| Totals | `price.withVat`, `withoutVat`, `vat`, `toPay` |
| Language | `data.order.language` (only with foreignLanguages module) |
| Sales channel | `data.order.salesChannelGuid` -> `GET /api/sales-channels/{guid}` |
| Source of order (Heureka, Zbozi, cash desk...) | `data.order.source.name`, `cashDeskOrder` |
| Items | `data.order.items[]` with `itemType`, `code`, `name`, `amount`, `unitPrice`, `itemPrice`, `purchasePrice`, `status` |
| Item types | `product`, `bazar`, `service`, `shipping`, `billing`, `discount-coupon`, `volume-discount`, `gift`, `gift-certificate`, `generic-item`, `product-set`, `product-set-item`, `deposit` |
| Payment | `paymentMethod.name`, `billingMethod.id` (1 = COD), `paid` |
| Customer | `email`, `customerGuid`, `billingAddress.vatId`, `vatIdValidationStatus`, `vatMode`, `vatPayer` |
| Paid status | `data.order.paid` (true/false/null) |

Doc quirk (VERIFIED): in the API response a coupon with absolute value, a volume discount, or a product with multiple VAT rates in the order are returned as ONE row, whereas the admin and PDF print one row per VAT rate. `items[].displayPrices[]` holds the printout version.

### 2.3 Exchange rate field

- `price.exchangeRate` and `price.invoicingExchangeRate`: pattern `^[0-9]+\.[0-9]{8}$`; "currency rate of the receipt for the default currency of the shop. This value is saved together with the price and reflects the historical value valid in the instant of the order creation. If the shop changes the default currency, the value still refers to the original currency!"
- Whether to multiply or divide depends on `eshop.settings.exchangeRateFlip` (boolean). Calibrate: take an EUR order and compare to the CZK invoice total.
- `invoicingExchangeRate` differs from `exchangeRate` when the document currency differs from the display currency. For revenue in CZK use the one matching the currency you are converting to; verify with a real invoice.

### 2.4 Multi-language, multi-domain

- Shoptet "foreign languages" is a paid module (`foreignLanguages`). Language is selected via the `language` query parameter on GET calls; texts come back in that language. Without the module, `order.language` is absent.
- Per-channel currencies and languages: `GET /api/sales-channels` -> `salesChannels[].{id,guid,name,type(in_store|online_store|marketplace|system),currencies[],languages[].{code,locale,isDefault,isVisible}}`. The mapping order -> channel is `order.salesChannelGuid`. Use it as the "storefront" key when set; it is nullable and old orders may lack it.
- Domain per storefront is NOT in the API. `GET /api/eshop` -> `contactInformation.url` is the primary domain only (a webhook `eshop:projectDomain` fires when it changes). A separate-project CZ and SK setup (two Shoptet shops) gives two tokens and two order streams: in that case market = which project the order came from.
- Country to market: Shoptet has no market object. Use `deliveryAddress.countryCode` as the market, `price.currencyCode` and `salesChannelGuid` as supporting keys.

### 2.5 XML / CSV order export (admin: Objednavky > Export > custom export type)

From a third-party connector template (Roivenue, https://docs.roivenue.com/roivenue-resources/roivenue-connectors/shoptet.md), tags and placeholders (VERIFIED as published by Roivenue; official Shoptet placeholder list at developers.shoptet.cz/importy-dat/ could not be fetched, connection closed):

- Order: `#id#`, `#code#`, `#date#`, `#statusName#`, `#packageNumber#`, `#remark#`, `#shopRemark#`, `#referer#`, `#customerIpAddress#`, `#weight#`.
- Currency: `#currencyCode#`, `#currencyExchangeRate#`.
- Billing: `#billFullName#`, `#billCompany#`, `#billStreet#`, `#billHouseNumber#`, `#billCity#`, `#billZip#`, `#billCountryName#`, `#billCompanyId#`, `#billVatId#`.
- Delivery: `#deliveryFullName#`, `#deliveryCompany#`, `#deliveryStreet#`, `#deliveryHouseNumber#`, `#deliveryCity#`, `#deliveryZip#`, `#deliveryCountryName#`.
- Totals: `#totalPriceWithVat#`, `#totalPriceWithoutVat#`, `#totalPriceVat#`, `#totalPriceRounding#`, `#totalPriceToPay#`, `#paid#`, `#orderPurchasePrice#`.
- Items: `#orderItemType#`, `#orderItemName#`, `#orderItemAmount#`, `#orderItemCode#`, `#orderItemVariantName#`, `#orderItemManufacturer#`, `#orderItemUnit#`, `#orderItemWeight#`, `#orderItemStatusName#`, `#orderItemDiscountPercent#`, `#orderItemUnitPrice(WithVat|WithoutVat|Vat|VatRate)#`, `#orderItemTotalPrice(WithVat|WithoutVat|Vat|VatRate)#`.
- GOTCHA: the export gives the country as a NAME (`#billCountryName#`, `#deliveryCountryName#`), localised to the admin language, not an ISO code. Normalise names to ISO codes (Czech "Ceska republika", "Slovensko", English "Czech Republic" etc.) or prefer the REST API where `countryCode` is ISO alpha-2.
- No language, sales channel or domain placeholder found in that template. Treat the XML export as the fallback for shops that cannot issue API tokens; the REST API is strictly richer.

## Part 3. Platform extras (Shopify and WooCommerce detail)

### 3.1 Shopify

- API ref: https://shopify.dev/docs/api/admin-graphql/latest/objects/Order (fields), /objects/LineItem, /objects/ShippingLine, /objects/Refund, /objects/OrderTransaction, /objects/TransactionFee, /objects/ShopifyPaymentsBalanceTransaction, /enums/ShopifyPaymentsTransactionType, /objects/InventoryItem, /objects/CustomerJourneySummary, /objects/TaxLine, /objects/MailingAddress.
- Money: every `*Set` field is a MoneyBag `{shopMoney{amount currencyCode}, presentmentMoney{amount currencyCode}}`. Deprecated single-value fields (`totalPrice`, `subtotalPrice`) are shop currency only. Always query `shopMoney` for the P&L and keep `presentmentMoney` for the "what the customer saw" view.
- Mapping to market without an Order.market field: build `country_code -> market` from `markets { regions { ... on MarketRegionCountry { code } } }` and refresh daily (markets can change). Shopify staff in the community thread said `shippingAddress.countryCodeV2` "should reflect the market the customer checked out through". `marketByGeography` is deprecated. https://community.shopify.dev/t/order-market-matching-discrepancy-between-orders-country-label-and-markets-country-label/34630
- Easier route for reporting: ShopifyQL `FROM sales SHOW ... GROUP BY market` (dimensions `market`, `markets`, `shipping_country_code`, `billing_country_code`, `order_checkout_currency`; metrics `gross_sales`, `discounts`, `returns`/reversals, `shipping_charges`, `taxes`, `cost_of_goods_sold`, `gross_profit`; dimension `new_or_returning_customer`). One order produces multiple rows when refunds follow. https://shopify.dev/docs/api/shopifyql/latest/schemas/sales_revenue/sales.md . Deprecated in 2026-10: `returns`, `net_returns`, `discounts_returned`, `taxes_returned`, `shipping_returned`, `quantity_returned`, `is_return_related`, `order_or_return` (renamed to `*_reversals`, `is_sales_reversal`, `order_or_sales_reversal`).
- Access: default last 60 days of orders only; older needs `read_all_orders`. Order-level scopes `read_orders`. Customer PII is protected customer data.
- Tax summary: `taxSummaryCreate` mutation exists (order id or date range) for VAT filing style data.
- Shopify Payments fees: `OrderTransaction.fees` is "only present for Shopify Payments transactions". For true cash view use balance transactions (`fee`, `net`, `type`).

### 3.2 WooCommerce

- REST v3 order schema (read from the official controller source): `currency`, `prices_include_tax`, `total`, `total_tax`, `discount_total`, `discount_tax`, `shipping_total`, `shipping_tax`, `cart_tax`, `billing{country,email,...}`, `shipping{country,...}`, `payment_method`, `payment_method_title`, `transaction_id`, `customer_id`, `date_paid_gmt`, `date_completed_gmt`, `line_items[]{product_id,variation_id,quantity,subtotal,subtotal_tax,total,total_tax,taxes[],sku,price}`, `tax_lines[]`, `shipping_lines[]`, `fee_lines[]`, `coupon_lines[]`, `refunds[]{id,reason,total,total_tax}`. Source: https://github.com/woocommerce/woocommerce/blob/trunk/plugins/woocommerce/includes/rest-api/Controllers/Version2/class-wc-rest-orders-v2-controller.php
- HPOS tables (default for new stores since WC 8.2): `wc_orders` (`currency`, `total_amount`, `tax_amount`, `customer_id`, `billing_email`, `payment_method`, `transaction_id`, `date_created_gmt`), `wc_order_addresses` (`address_type`,`country`,`email`), `wc_order_operational_data` (`prices_include_tax`, `shipping_total_amount`, `shipping_tax_amount`, `discount_total_amount`, `discount_tax_amount`, `date_paid_gmt`), `wc_orders_meta`. Source: https://github.com/woocommerce/woocommerce/blob/trunk/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableDataStore.php (get_database_schema). Line items: `woocommerce_order_items` + `woocommerce_order_itemmeta` (`_product_id`, `_qty`, `_line_subtotal`, `_line_total`, `_line_tax`, `_cogs_value` style meta UNVERIFIED).
- Analytics lookup tables (derived, may lag, cover only statuses configured as "actionable/excluded"): `wc_order_stats` (`total_sales`, `tax_total`, `shipping_total`, `net_total`, `returning_customer`, `customer_id`, `status`), `wc_customer_lookup` (`country`, `email`), `wc_order_product_lookup` (`product_net_revenue`, `product_gross_revenue`, `coupon_amount`, `tax_amount`, `shipping_amount`), `wc_order_coupon_lookup`, `wc_order_tax_lookup`. Prefer the REST/HPOS source over these for the P&L; use `returning_customer` only as a cross-check. Source: includes/class-wc-install.php.
- Native COGS: https://developer.woocommerce.com/2025/05/21/cost-of-goods-soldcogs-is-ready-to-blossom-out-of-beta-this-summer/ . REST: product `cost_of_goods_sold.{values[],total_value}`; order `cost_of_goods_sold.total_value`; line `cost_of_goods_sold.value` (present only when the feature is enabled). Cost is stored per order item at order time, refunds return negative cost. Author's replies: not yet in Woo Analytics.
- Variations: `product.regular_price`, `sale_price`, `price`, `on_sale`, `date_on_sale_from`, `date_on_sale_to`. Order lines keep only the charged `price`.
- Stripe fee meta (official gateway): `_stripe_fee`, `_stripe_net`, `_stripe_currency` (constants in WC_Stripe_Helper, https://github.com/woocommerce/woocommerce-gateway-stripe). Currency of these values is `_stripe_currency` (settlement), which may differ from the order currency.

## Part 4. Ad platforms and analytics

### 4.1 Meta Marketing API (Insights)

Docs: https://developers.facebook.com/documentation/ads-commerce/marketing-api/insights/breakdowns.md and https://developers.facebook.com/docs/marketing-api/insights/breakdowns/

| Topic | Finding |
|---|---|
| Request | `GET /act_{id}/insights?level=campaign|adset|ad&breakdowns=country&fields=spend,impressions,clicks,actions,action_values,purchase_roas&time_increment=1&action_attribution_windows=["7d_click","1d_view"]`. `action_breakdowns` default `action_type` (implicit). Purchase count = `actions[action_type=purchase]` (or `omni_purchase`), value = `action_values[action_type=purchase]`. |
| Definition of country | "The country where the people you've reached are located", inferred from hometown, current city and where the person tends to be when visiting Meta. NOT the targeting country. Expect small spend rows for countries you never targeted (travellers, expats). Insights breakdown values are "estimated" (Meta wording). |
| Combination limits | `country` is joinable with `action_type` (asterisked permutation), so spend + purchases + purchase value per country works. `region` and `dma` lose some off-Meta action metrics; hourly breakdowns do not support `reach`/`frequency`/`unique_*`. Only documented permutations are available "due to storage constraints"; do NOT add `age`, `gender`, `publisher_platform` on top of `country` plus actions without testing. |
| Attribution windows | Action metrics are not returned when "attempted aggregation across multiple attribution settings". Since 2026-01-12 `7d_view` and `28d_view` return no data (Meta developer blog 2025-10-16, https://developers.facebook.com/blog/post/2025/10/16/ads-insights-api-metric-availability-updates/ ). Keep one fixed window set in the warehouse (e.g. `7d_click`+`1d_view` as separate columns) and store `attribution_window` as a column. |
| Retention | Same January 2026 change: breakdowns for unique-count fields (`unique_*`, reach) and hourly breakdowns are capped at 13 months of history; `frequency_value` at 6 months. Standard fields with `country` are not covered by that cap (general insights retention is 37 months, UNVERIFIED in docs read). Backfill and store daily rows immediately. |
| Summing | Sum of country rows should equal the no-breakdown total for spend and impressions; reach does NOT sum across countries (people reached in two countries). Reconcile spend daily and keep an `unallocated` row if different. |
| Advantage+ | Advantage+ Sales (formerly Advantage+ Shopping) campaigns return the same `country` breakdown, because it is a delivery-side breakdown independent of campaign type. Targeting several countries in one Advantage+ campaign mixes spend; Meta allocates by expected return, so country split is outcome, not input. Keep one country per campaign (or per ad set) where the client wants budget control. Auction competition, CPM and ROAS differ strongly by country, so country-level ROAS from a multi-country campaign must be shown with spend share. |
| Alternatives | `breakdowns=mmm` is ad-set level only and returns only impressions and spend (no purchases). Not useful for the P&L. |
| Purchase attribution vs shop country | Meta country is the person's location, the shop country is the SHIPPING country. Expect mismatch (CZ resident ships to SK). Compare at market level with a tolerance and show "Meta reported" next to "shop reported" instead of dividing one by the other blindly. |

### 4.2 Google Ads API

Docs: https://developers.google.com/google-ads/api/fields/v26/geographic_view and /user_location_view ; protos read from https://github.com/googleapis/googleapis/tree/master/google/ads/googleads/v26 (current versions in repo: v23 to v26).

| Resource | Meaning (from official proto comments, VERIFIED) | Key fields |
|---|---|---|
| `geographic_view` | "Metrics aggregated at the country level, one row per country. It reports metrics at either actual physical location of the user or an area of interest. If other segment fields are used, you may get more than one row per country." | `geographic_view.country_criterion_id` (int64), `geographic_view.location_type` (`AREA_OF_INTEREST` = location the user is interested in when making the query, `LOCATION_OF_PRESENCE` = location of the user issuing the query). Resource name `customers/{id}/geographicViews/{country_criterion_id}~{location_type}`. |
| `user_location_view` | "Metrics aggregated at the country level ... at the actual physical location of the user by targeted or not targeted location." | `user_location_view.country_criterion_id`, `user_location_view.targeting_location` (bool: was the location targeted). |
| Segment alternative | `segments.geo_target_country` (resource name of the country geo target constant) exists on `segments` in v26; `segments.geo_target_region/city/...` too; `segments.product_country` (country of sale of the product) and `segments.product_feed_label` for Shopping and PMax retail. | Use with `shopping_performance_view` when the feed is split per country. |

Notes and gotchas:
- `geographic_view` is the right source for "spend by country". Each campaign x day x country x location_type combination is a row. To avoid DOUBLE COUNTING, filter to ONE `location_type` (for spend use `LOCATION_OF_PRESENCE` if you want where the user was; `AREA_OF_INTEREST` is where the query was about). Totals from both types sum to about 2x the real cost. Always reconcile to `campaign` level cost_micros.
- Resolve `country_criterion_id` to ISO via `geo_target_constant` (`country_code`, `canonical_name`, `target_type='Country'`) rather than hardcoding ids. `metrics.cost_micros` is in micros of the ACCOUNT currency.
- Performance Max: the official PMax reporting page lists location reporting only via `location_view` (campaign location CRITERIA performance), which returns nothing if no location criterion is set; the resource doc for `LocationView` says to use `geographic_view` or `user_location_view` for visitor location. I found no official statement that `geographic_view` returns PMax rows, so TEST it on a PMax campaign and reconcile with `campaign.cost_micros`. `ad_group` and `ad_group_ad` return no PMax data (asset groups instead). Source: https://developers.google.com/google-ads/api/performance-max/reporting
- Shopping and PMax-retail campaigns are normally split by feed label / country of sale, so `campaign` x `shopping_performance_view` + `segments.product_country` gives the market even when the campaign targets several countries.
- Conversions: country-level `metrics.conversions` and `conversions_value` are available on the geo views (resources listed under "Resources with metrics"), but Google Ads conversions are attributed by Google's model, not the shop's own orders. Use as a spend and click source, not as revenue truth.

### 4.3 Sklik (Seznam)

- API: Sklik API Drak, https://api.sklik.cz/drak/ (changelog at /changelog.html, latest entry seen 2025-11-11). Methods `campaigns.createReport`, `campaigns.readReport`, `groups.*`, `ads.*`, `keywords.*`, `queries.readReport`, `stats.*`.
- Reporting segmentation: `statGranularity` only splits by TIME (`total, daily, weekly, monthly, quarterly, yearly`). I found NO geographic breakdown parameter in `createReport` or `readReport` (VERIFIED on pages campaigns.createReport and campaigns.readReport).
- Geo is a TARGETING attribute of a campaign: report attributes `regions.id`, `regions.parentId`, `regions.name` (predefined region id for geotargeting). So the only usable split is "one campaign = one geo target" and read the campaign's regions + its stats. Listing limit about 100 rows per call, lower with daily granularity (third-party connector docs).
- Fallback: naming suffix (see 4.5) plus the `regions` attribute as a validator.

### 4.4 GA4

| Need | Source |
|---|---|
| Sessions / users by country | BigQuery export `events_*`: `geo.country`, `geo.region`, `geo.city`, `geo.continent`, `geo.sub_continent`, `geo.metro`; all "based on IP address" (VERIFIED, https://support.google.com/analytics/answer/7029846). Data API: dimensions `country`, `countryId` (ISO 3166-1 alpha-2), `region`, `city` (https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema). |
| Purchases / revenue by country | `event_name='purchase'` rows: `ecommerce.transaction_id`, `ecommerce.purchase_revenue` (local currency), `ecommerce.purchase_revenue_in_usd`, `ecommerce.shipping_value`, `ecommerce.tax_value`, `ecommerce.total_item_quantity`, plus event param `currency`. |
| Session and campaign | `ga_session_id` and `ga_session_number` are event params; `session_traffic_source_last_click` and `collected_traffic_source` (gclid, manual_source...) are records; `traffic_source.*` is FIRST-USER acquisition, not session. |
| Demand from unsold countries | Sessions, add-to-cart and begin_checkout by `geo.country` for countries with zero or few orders; compare with Search Console `country` (clicks/impressions) and Ads impression share by country. `begin_checkout` or `add_shipping_info` from a country where the shop cannot ship is the strongest signal. Treat bot and VPN traffic: US, Ireland and Netherlands often inflate (cloud IPs); filter on `engaged_sessions` or session duration and ignore data-center countries. |

Gotchas for GA4:
- Geo comes from IP at event time, so one session can contain events from two countries (VPN, mobile roaming). Take `geo.country` from `session_start` or the first event of `ga_session_id`.
- Daily BigQuery export cap for standard properties is 1 million events per day (https://support.google.com/analytics/answer/9358801). Large clients silently stop exporting if they exceed it; use streaming (no volume limit, adds cost) or GA4 360. Query `events_YYYYMMDD`, not `events_intraday_*` (intraday has gaps and no `traffic_source`).
- Consent mode: cookieless pings can appear in the export; counts differ from the Data API (thresholding, modeling). GA4 revenue never equals shop revenue; use it for ratios (CVR by country), not for the P&L.

### 4.5 Fallback when the platform cannot split spend by country

1. Campaign naming convention: suffix `_CZ`, `_SK`, `_DE`, `_EU` (ISO alpha-2) at the END of campaign (and ad set) name, uppercase, separated by underscore: `{brand}_{objective}_{audience}_{CZ}`. Parse with `REGEXP_EXTRACT(name, r'_([A-Z]{2})(?:_|$)')`. Store the parsed value in a `market_source` column (`name_suffix`, `api_breakdown`, `targeting`, `manual_map`).
2. Validator: compare the suffix to the real targeting (Meta ad set `targeting.geo_locations.countries`; Google campaign location criteria; Sklik `regions`). If they disagree, flag the campaign `market_conflict`.
3. Multi-country campaign (`EU`, `CEE`, no suffix): use the platform country breakdown where it exists (Meta, Google geographic_view); for Sklik or untagged rows allocate spend by that day's sessions or orders share per country (`market_source='allocated'`) and tag it "estimated" in the UI.
4. Keep a `campaign_market_map` table in BigQuery (client_id, platform, campaign_id, market, valid_from, valid_to, source) so manual fixes survive renames.

## Part 5. Gotchas list

1. Shopify presentment vs shop money: pick `shopMoney` for P&L. `presentmentMoney` is what the customer paid in; mixing them silently skews EU totals when the shop currency is CZK.
2. Shopify has no market on the order; map via shipping country code. Draft and POS orders may have no shipping address; digital orders have none. Fall back to billing, then to `unknown`.
3. WooCommerce multi-currency stores order totals in the CUSTOMER currency, unconverted. Converting needs the rate stored on the order (`_woocs_order_rate`, `wmc_order_info`), which can be missing: WOOCS writes it only on the thank-you page hook; CURCY orders created via REST or while the plugin was off have none. Never convert with today's rate.
4. Shoptet `price.exchangeRate` is frozen at order time but refers to the shop's ORIGINAL default currency; direction depends on `settings.exchangeRateFlip`. Calibrate on one foreign-currency order.
5. Shoptet list endpoint has no country, items or language. You need detail or snapshot. Snapshot is async jsonlines.gz.
6. Shoptet XML export returns country NAMES in the admin language, not ISO codes.
7. Shoptet discounts are negative ITEMS (`discount-coupon`, `volume-discount`), shipping and payment (COD fee) are also items (`shipping`, `billing`). Summing all items gives the total; summing only products gives gross sales. API returns one discount row where the PDF shows one per VAT rate.
8. Tax inclusive vs exclusive differs per platform and per order. Compute revenue NET of VAT. Shopify: `taxesIncluded`; Woo: `prices_include_tax`; Shoptet: use `withoutVat`. A "gross revenue" market comparison between CZ (21 percent) and SK (23 percent from 2025) is biased.
9. EU OSS: destination-country VAT applies for B2C cross-border; Shoptet exposes `vatMode` (OSS) and per-country `ossVatLevels`. Margin by market after VAT only works if VAT is taken from the order, not from a flat rate.
10. COD has no universal flag on Shopify (custom manual gateway name). Shoptet `billingMethod.id == 1`, Woo `payment_method == 'cod'`. COD refusal creates "paid shipping with no revenue"; handle as cancellation with shipping cost.
11. Refunds: Woo order `total` is not reduced; Shopify `total` stays, use `currentTotalPriceSet`; Shoptet refunds live in separate credit-note documents. Book refunds on the refund date and also keep the original order month link.
12. Compare-at / regular price is NOT stored on the order anywhere. Snapshot catalogue prices daily to measure markdowns by market.
13. Shipping COST to the merchant is not in any of the three order APIs (Shopify only for labels bought in Shopify Shipping). Use a carrier rate-card table.
14. Payment fees: only Shopify Payments (API) and Woo Stripe (meta) expose actual fees. Everything else needs a rate table; fees can be in settlement currency.
15. Customer country does not exist on Shopify `Customer`; always assign market per order. New vs returning: compute yourself by email hash across the whole history (Shopify `customerOrderIndex` is okay but ignores guest checkouts with different emails).
16. COGS: Shopify `unitCost` is the current cost (snapshot nightly; ShopifyQL computes COGS at sale time); Shoptet purchase price may be nullable and VAT-inclusive-flagged; Woo native COGS is opt-in and not retroactive.
17. Meta `country` is audience location, not targeting nor shipping country; multi-country Advantage+ campaigns blend markets; January 2026 removed `7d_view`/`28d_view`; unique/hourly breakdowns are limited to 13 months.
18. Google `geographic_view` returns one row per location_type; summing both double counts. PMax country data must be verified against campaign cost.
19. Sklik cannot split stats by geo; naming suffix and campaign `regions` attribute are the only route.
20. GA4 geo is IP-based, per event, and the standard BigQuery export is capped at 1M events/day. Demand analysis (unsold countries) is directional only.

## Part 6. Open items to verify on live data before building the model

- Real Shoptet order with EUR: confirm direction of `exchangeRate` and whether `invoicingExchangeRate` differs.
- A Shoptet shop with foreign languages and a SK domain: check whether `salesChannelGuid` and `language` are populated and whether the SK storefront is a sales channel or a separate project. (The official placeholder list for the XML export at developers.shoptet.cz could not be fetched; connection was closed.)
- Shopify: confirm `AutomaticDiscountApplication` / `ManualDiscountApplication` type names via `graphql_schema` introspection.
- WooCommerce: dump one multi-currency order's meta from each plugin (Aelia, WCML keys not confirmed), and check native COGS is enabled per client.
- Meta: reconcile `breakdowns=country` spend to account total for a week; test Advantage+ campaign rows.
- Google: run `geographic_view` filtered to a PMax campaign and compare to `campaign.cost_micros`.
