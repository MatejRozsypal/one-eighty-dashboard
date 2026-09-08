# 27. ClickUp to BigQuery, and write-back

> Feeds `ref.creative_tags`, `ref.concepts`, `ref.personas` and `ref.creators`, which are the spine
> of the Creative Engine. **Nothing in the repo does this today.** There is no ClickUp workflow, no
> ClickUp secret, and no `raw_clickup_*` table. Everything below is new build.
>
> Prerequisite reading: `CREATIVE_ENGINE_BRIEF.md` sections 3 and 4.

---

## 1. What does not exist yet

| Piece | Status | Note |
|---|---|---|
| ClickUp API token in Secret Manager | **missing** | Existing pattern is `meta-{slug}-access-token`. ClickUp is one workspace-wide token, so use `clickup-api-token` with no slug |
| `raw.raw_clickup_tasks` | **missing** | |
| `ref.clickup_lists` registry | **missing** | Maps client_id to its three list IDs |
| `ref.clickup_field_map` | **missing** | Logical name to field UUID, per client |
| n8n workflow | **missing** | `wf_clickup_to_bigquery.json` |
| Write-back path | **missing** | Dashboard server action, not n8n |
| Fields on the ClickUp lists | **partly missing** | See section 6 |

## 2. Authentication

One personal API token for the whole workspace. ClickUp personal tokens are prefixed `pk_` and do
not expire.

```bash
gcloud secrets create clickup-api-token --replication-policy=automatic --project=oneeighty-warehouse
printf '%s' 'pk_XXXXXXXX' | gcloud secrets versions add clickup-api-token --data-file=-
```

Grant the n8n service account `roles/secretmanager.secretAccessor` on it, the same way the Meta
secrets are granted. In n8n, read it with the same Google Secret Manager REST node the Meta workflow
uses; do not paste the token into a node.

Header on every request: `Authorization: pk_XXXX`. No `Bearer` prefix. This is a common mistake and
it returns `OAUTH_019` rather than a clear 401.

**Rate limit is 100 requests per minute per token** on Business plans. A full sync of three lists per
client for two clients is roughly 20 requests, so this is not a constraint today, but the workflow
must still handle `429` with a backoff or a growing workspace will break it silently.

## 3. Workspace and list registry

Workspace `90151448219`, space `Client Success` (`90155879991`).

```sql
CREATE TABLE `oneeighty-warehouse.ref.clickup_lists` (
  client_id STRING NOT NULL,
  list_kind STRING NOT NULL,   -- 'ad_pipeline' | 'concepts' | 'personas'
  list_id   STRING NOT NULL,
  folder_id STRING,
  active    BOOL NOT NULL
);
```

Seed:

| client_id | ad_pipeline | concepts | personas |
|---|---|---|---|
| manami | `901521546599` | `901523916078` | `901523916330` |
| venev | `901524795825` | `901524795828` | `901524795826` |
| *(template)* | `901524031947` | `901524031954` | `901524031962` |

The `_Template client` folder (`901516477964`) is the source for new clients. Onboarding a client
means duplicating that folder and inserting one row per list here.

## 4. Field map, and why it cannot be hard-coded

Most custom fields on the ad pipeline are **space-level and therefore share a UUID across clients**.
Verified 8 Sep 2026:

| Logical name | Field UUID | Shared? |
|---|---|---|
| `Creative ID` | `a80bdd5a-b4e5-4e70-81ce-0be80d57b768` | shared |
| `Content Format` | `4bac144c-3d1f-465f-b8e8-0b8d6903297c` | shared |
| `Content Purpose` | `27534262-67e8-4dfd-b669-1e62618de015` | shared |
| `Market` | `4ec43059-4de0-410c-a097-b1496acc25bf` | shared |
| `Visual Type` | `db1172b8-0b1a-4d47-84e4-ab627937ac77` | shared |
| `Output` / `Input` / `Reference` / `Internal Output` | `8ffabc06…` / `72a1428e…` / `c995003b…` / `5d0860ef…` | shared |

**Relationship fields are not shared, and one of them is currently wrong.**

| Client | Field | UUID | Points at |
|---|---|---|---|
| manami | `Concept` | `248a6bfa-d0f7-41e4-a130-64b0eeddbfbe` | `901523916078` Man: Concept list. Correct |
| venev | `Concept` | `05c15839-5c8c-4e43-98d5-39f5e4c4e994` | `901523916078` **Man: Concept list. WRONG** |
| venev | `VEN: Concept` | `bcf4d0be-3b8c-46b6-975c-c3958fb5c77c` | `901524795828` VEN: Concept list. Correct |

> **Fix before Phase 3.** Delete `05c15839-…` from the Venev ad pipeline, or the sync attaches Venev
> ads to Manami concepts and nobody notices until a breakdown looks strange. Until it is deleted,
> the field map below pins the correct UUID and the loader must ignore any other relationship field.

```sql
CREATE TABLE `oneeighty-warehouse.ref.clickup_field_map` (
  client_id  STRING NOT NULL,
  list_kind  STRING NOT NULL,
  logical    STRING NOT NULL,   -- 'creative_id','concept_rel','content_format', ...
  field_id   STRING NOT NULL,
  field_type STRING NOT NULL
);
```

Refresh it from `GET /api/v2/list/{list_id}/field` on every run and warn, do not fail, when a
logical name resolves to more than one field. Silent duplicate resolution is exactly how the Venev
defect would have propagated.

## 5. Endpoints

```
GET /api/v2/list/{list_id}/field                     custom field definitions
GET /api/v2/list/{list_id}/task
      ?include_closed=true&subtasks=false&page={n}   100 tasks/page, custom_fields included
POST /api/v2/task/{task_id}/field/{field_id}         write-back, body {"value":"<ad_id,ad_id>"}
```

`GET /list/{id}/task` already returns `custom_fields` in full, so there is **no need to fetch tasks
individually.** Paginate until `last_page: true`.

Values arrive typed by field:
- `short_text` and `url`: `value` is a string.
- `drop_down`: `value` is the option **orderindex integer**, not the label. Resolve it against
  `type_config.options[].orderindex`. Storing the integer alone is useless six months later.
- `list_relationship`: `value` is an array of `{id, name}` objects.
- `date`: epoch milliseconds as a string.

## 6. ClickUp fields that must be created before the sync is useful

Per `CREATIVE_ENGINE_BRIEF.md` section 3, on each `<Client>: Ad pipeline`:

`Offer` (dropdown: Testovací sada, Plná velikost, Promo, Kvíz, Dárek), `Production method`
(dropdown: Internal studio, AI generated, UGC, Influencer, Agency), `Creator` (dropdown or
relationship), `Creator type` (dropdown: Agency, Brand employee, UGC creator, Influencer), `Body`
(short text), `Hook` (short text), `Production cost` (number), `Brief` (url).

On `<Client>: Concept list`: add `Persona` as a relationship to the Persona Bank, and enforce
single-select on `Angle` and `Persona`.

Create them **at space level** so they stay shared across clients, and add the new UUIDs to the
field map table.

## 7. Raw landing table

```sql
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.raw.raw_clickup_tasks` (
  client_id     STRING    NOT NULL,
  ingested_at   TIMESTAMP NOT NULL,
  snapshot_date DATE      NOT NULL,
  list_kind     STRING    NOT NULL,
  list_id       STRING    NOT NULL,
  task_id       STRING    NOT NULL,
  task_name     STRING,
  task_url      STRING,
  status        STRING,
  status_type   STRING,
  date_created  TIMESTAMP,
  date_updated  TIMESTAMP,
  date_closed   TIMESTAMP,
  assignees     ARRAY<STRING>,
  custom_fields ARRAY<STRUCT<field_id STRING, name STRING, type STRING,
                             value_text STRING, value_num NUMERIC,
                             value_ids ARRAY<STRING>>>,
  payload_json  STRING
)
PARTITION BY snapshot_date
CLUSTER BY client_id, list_kind, task_id
OPTIONS (require_partition_filter = TRUE);
```

Append-only, snapshot per run, exactly like the Meta raw tables. `stg.stg_clickup_tasks` dedupes on
`(client_id, task_id)` by newest `ingested_at`, the same pattern as `stg_meta_ad_insights` in
`200_create_stg_views.sql`.

## 8. Building `ref.creative_tags`

One row per `(client_id, ad_id)`. A ClickUp task can produce several rows, because post-ID
graduation gives the same creative a second `ad_id`.

```
1. Read stg_clickup_tasks for list_kind = 'ad_pipeline'.
2. Split the Creative ID field on commas. Trim. Drop empties and drop the literal 'Creative ID'.
3. For each ad_id: match_method = 'creative_id', match_confidence = 1.0.
4. Ads in stg_meta_ad_insights with no match go to the unmapped queue. Score them:
     exact ad_name equality with a task name       -> 'name_exact', 0.95
     persona token + date + format token agreement -> 'name_fuzzy', 0.5 to 0.9
   Never auto-apply below 1.0. A human confirms, and the confirmation writes back.
5. Denormalise persona, angle and offer FROM THE CONCEPT, never from the ad task.
   An ad inherits; it cannot override. Master SOP section 4.4.
```

Rebuild it in full on every run. It is a few thousand rows and incremental logic here buys nothing
but bugs.

## 9. Write-back

**Not in n8n.** It happens in the dashboard as a Next.js server action, because it is triggered by a
person clicking Confirm in the Unmapped ads queue.

```
POST /api/v2/task/{task_id}/field/a80bdd5a-b4e5-4e70-81ce-0be80d57b768
{"value": "120210000000000123,120210000000000456"}
```

- Read the current value first and **append**, never overwrite. Post-ID graduation depends on it.
- Write to ClickUp first, then insert the mapping locally. If ClickUp fails, show the error and
  change nothing, so the two systems cannot disagree.
- Log every write to the `access_log` table with the actor's email.
- The ClickUp token is a workspace-wide write credential. Keep it server-side, never in a client
  component, and never in `NEXT_PUBLIC_*`.

## 10. Schedule

Hourly at `:45`, offset from the Meta workflow's `:15` so tags land after the delivery data they
describe. Full refresh, roughly 20 API calls, well inside the rate limit.

Log to `ops.pipeline_log` with `source = 'clickup'` so `runbooks/26_pipeline_freshness_monitoring.md`
picks it up without modification.

## 11. Verification

```sql
-- tags exist and the placeholder is not being ingested as data
SELECT COUNT(*) AS tagged,
       COUNTIF(concept_id IS NULL) AS no_concept,
       COUNTIF(ad_id = 'Creative ID') AS placeholder_leak
FROM `oneeighty-warehouse.ref.creative_tags` WHERE client_id = 'manami';

-- the number that decides whether the Breakdown screen may be switched on
SELECT ROUND(100 * SUM(IF(t.concept_id IS NULL, 0, p.spend)) / SUM(p.spend)) AS pct_spend_tagged
FROM `oneeighty-warehouse.mart.mart_meta_ad_perf` p
LEFT JOIN `oneeighty-warehouse.ref.creative_tags` t USING (client_id, ad_id)
WHERE p.client_id = 'manami' AND p.date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY);

-- cross-client leakage: must return zero rows
SELECT t.client_id, c.client_id AS concept_client, COUNT(*) AS n
FROM `oneeighty-warehouse.ref.creative_tags` t
JOIN `oneeighty-warehouse.ref.concepts` c USING (concept_id)
WHERE t.client_id != c.client_id GROUP BY 1,2;
```

The third query is the guard against the Venev relationship-field defect. Run it after every sync
until the stale field is deleted.
