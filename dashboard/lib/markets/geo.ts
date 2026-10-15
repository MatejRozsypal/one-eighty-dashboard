/**
 * World outlines for the Markets map, projected on the server.
 *
 * The outlines come from the `world-atlas` package (Natural Earth, public
 * domain), imported as JSON, so they are part of the server build and never
 * fetched at runtime. Projection happens here too: the browser receives SVG
 * path strings for the countries inside the frame and nothing else, so the
 * atlas (0.1 to 0.75 MB) never reaches the client bundle.
 *
 * ── Framing ─────────────────────────────────────────────────────────────────
 * The frame is the box around the client's markets plus a margin, so a US/CA
 * client opens on North America and a CZ/SK client on Central Europe. Large
 * countries are framed by their mainland (no Alaska, Hawaii or the Arctic
 * islands), otherwise the box would be mostly ocean and ice. The projection
 * follows the box: conic conformal for the Americas, Mercator for a regional
 * European box, Natural Earth once a frame spans an ocean.
 */

import "server-only";
import {
  geoArea,
  geoBounds,
  geoConicConformal,
  geoMercator,
  geoNaturalEarth1,
  geoPath,
  type GeoProjection,
} from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from "geojson";
import world110 from "world-atlas/countries-110m.json";
import world50 from "world-atlas/countries-50m.json";

/** ISO 3166-1 alpha-2 to the numeric id world-atlas uses, packed as "CC000". */
const ISO_PACKED =
  "AD020AE784AF004AG028AI660AL008AM051AO024AQ010AR032AS016AT040AU036AW533AX248AZ031BA070BB052BD050BE056" +
  "BF854BG100BH048BI108BJ204BL652BM060BN096BO068BR076BS044BT064BW072BY112BZ084CA124CD180CF140CG178CH756" +
  "CI384CK184CL152CM120CN156CO170CR188CU192CV132CW531CY196CZ203DE276DJ262DK208DM212DO214DZ012EC218EE233" +
  "EG818EH732ER232ES724ET231FI246FJ242FK238FM583FO234FR250GA266GB826GD308GE268GG831GH288GL304GM270GN324" +
  "GQ226GR300GS239GT320GU316GW624GY328HK344HM334HN340HR191HT332HU348ID360IE372IL376IM833IN356IO086IQ368" +
  "IR364IS352IT380JE832JM388JO400JP392KE404KG417KH116KI296KM174KN659KP408KR410KW414KY136KZ398LA418LB422" +
  "LC662LI438LK144LR430LS426LT440LU442LV428LY434MA504MC492MD498ME499MF663MG450MH584MK807ML466MM104MN496" +
  "MO446MP580MR478MS500MT470MU480MV462MW454MX484MY458MZ508NA516NC540NE562NF574NG566NI558NL528NO578NP524" +
  "NR520NU570NZ554OM512PA591PE604PF258PG598PH608PK586PL616PM666PN612PR630PS275PT620PW585PY600QA634RO642" +
  "RS688RU643RW646SA682SB090SC690SD729SE752SG702SH654SI705SK703SL694SM674SN686SO706SR740SS728ST678SV222" +
  "SX534SY760SZ748TC796TD148TF260TG768TH764TJ762TL626TM795TN788TO776TR792TT780TW158TZ834UA804UG800US840" +
  "UY858UZ860VA336VC670VE862VG092VI850VN704VU548WF876WS882YE887ZA710ZM894ZW716";

const ISO_TO_NUM = new Map<string, string>();
const NUM_TO_ISO = new Map<string, string>();
for (let i = 0; i < ISO_PACKED.length; i += 5) {
  const iso = ISO_PACKED.slice(i, i + 2);
  const n = ISO_PACKED.slice(i + 2, i + 5);
  ISO_TO_NUM.set(iso, n);
  NUM_TO_ISO.set(n, iso);
}

type Box = [[number, number], [number, number]];

/** Mainland boxes for countries whose full extent would wreck the frame. */
const FRAME_BOX: Record<string, Box> = {
  US: [[-124.8, 24.5], [-66.9, 49.4]],
  CA: [[-132, 42], [-56, 60]],
  RU: [[27, 42], [60, 68]],
  FR: [[-5, 42.3], [8.3, 51.1]],
  NO: [[4.6, 58], [31, 71]],
  DK: [[8, 54.5], [12.7, 57.8]],
  NL: [[3.3, 50.7], [7.2, 53.6]],
  ES: [[-9.4, 36], [3.3, 43.8]],
  PT: [[-9.6, 36.9], [-6.2, 42.2]],
  AU: [[113, -39.2], [153.7, -10.6]],
  NZ: [[166, -47.3], [178.6, -34.4]],
  GB: [[-8.2, 49.9], [1.8, 58.7]],
};

/** Where a country's label sits, for countries whose centroid reads wrong. */
const LABEL_AT: Record<string, [number, number]> = {
  US: [-98.5, 39.2],
  CA: [-106, 56],
  FR: [2.4, 46.6],
  NO: [9.5, 61],
  GB: [-1.8, 53],
  HR: [16, 45.6],
};

type Countries = Array<Feature<Geometry, { name: string }>>;
const cache: { c110?: Countries; c50?: Countries } = {};

function countries(detail: "110m" | "50m"): Countries {
  const key = detail === "110m" ? "c110" : "c50";
  if (!cache[key]) {
    const topo = (detail === "110m" ? world110 : world50) as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
    const fc = feature(topo, topo.objects.countries) as unknown as FeatureCollection<Geometry, { name: string }>;
    cache[key] = fc.features;
  }
  return cache[key]!;
}

function isoOf(f: Feature): string | null {
  return f.id === undefined ? null : NUM_TO_ISO.get(String(f.id)) ?? null;
}

/** True when world-atlas has an outline for this ISO-2 code. */
export function hasOutline(iso: string): boolean {
  const n = ISO_TO_NUM.get(iso);
  return n !== undefined && countries("110m").some((f) => String(f.id) === n);
}

function boxOf(iso: string, f: Feature): Box | null {
  if (FRAME_BOX[iso]) return FRAME_BOX[iso];
  const [[x0, y0], [x1, y1]] = geoBounds(f);
  if (!Number.isFinite(x0) || x0 > x1) return null;
  return [[x0, y0], [x1, y1]];
}

/** The largest ring of a country, so the label lands on the mainland. */
function mainPart(f: Feature<Geometry>): Feature<Geometry> {
  if (f.geometry.type !== "MultiPolygon") return f;
  const polys = (f.geometry as MultiPolygon).coordinates;
  let best = polys[0];
  let bestArea = -1;
  for (const p of polys) {
    const a = geoArea({ type: "Polygon", coordinates: p } as Polygon);
    if (a > bestArea) {
      bestArea = a;
      best = p;
    }
  }
  return { ...f, geometry: { type: "Polygon", coordinates: best } as Polygon };
}

export interface MapCountry {
  /** ISO-2, or null for a territory the mapping does not cover. */
  iso: string | null;
  d: string;
}

export interface MapGeometry {
  width: number;
  height: number;
  countries: MapCountry[];
  /** Label anchor per requested ISO, in SVG units. */
  labels: Record<string, [number, number]>;
  /** Area the outlines cover, in SVG units (wider than the frame): the pan limit. */
  extent: Box;
}

const WIDTH = 800;

/**
 * Projected outlines framed to `focus` (the client's markets), with labels for
 * `focus` and `extra` (scouting candidates, members of Other). Null when a
 * focus country has no outline in the atlas, which the page answers with the
 * tile grid rather than a map framed on the wrong place.
 */
export function buildMapGeometry(focus: string[], extra: string[] = []): MapGeometry | null {
  if (focus.length === 0) return null;
  const all110 = countries("110m");
  const byIso = new Map<string, Feature<Geometry, { name: string }>>();
  for (const f of all110) {
    const iso = isoOf(f);
    if (iso) byIso.set(iso, f);
  }

  const boxes: Box[] = [];
  for (const iso of focus) {
    const f = byIso.get(iso);
    if (!f) return null;
    const b = boxOf(iso, f);
    if (!b) return null;
    boxes.push(b);
  }

  let x0 = Math.min(...boxes.map((b) => b[0][0]));
  let y0 = Math.min(...boxes.map((b) => b[0][1]));
  let x1 = Math.max(...boxes.map((b) => b[1][0]));
  let y1 = Math.max(...boxes.map((b) => b[1][1]));
  const padX = Math.max(1.6, (x1 - x0) * 0.14);
  const padY = Math.max(1.0, (y1 - y0) * 0.14);
  x0 -= padX; x1 += padX; y0 = Math.max(-80, y0 - padY); y1 = Math.min(84, y1 + padY);

  const spanX = x1 - x0;
  const cx = (x0 + x1) / 2;
  let projection: GeoProjection;
  if (spanX > 90) projection = geoNaturalEarth1();
  else if (cx < -30) {
    const third = (y1 - y0) / 3;
    projection = geoConicConformal().rotate([-cx, 0]).parallels([y0 + third, y1 - third]);
  } else projection = geoMercator();

  // The box as points along its edges: on a conic projection a straight
  // parallel is a curve, and the corners alone would cut its middle off.
  const edge: Array<[number, number]> = [];
  for (let i = 0; i <= 8; i++) {
    const x = x0 + (spanX * i) / 8;
    edge.push([x, y0], [x, y1]);
  }
  edge.push([x0, (y0 + y1) / 2], [x1, (y0 + y1) / 2]);
  const frame = { type: "MultiPoint" as const, coordinates: edge };

  projection.fitWidth(WIDTH, frame);
  const [[, fy0], [, fy1]] = geoPath(projection).bounds(frame);
  const height = Math.round(Math.min(0.72, Math.max(0.46, (fy1 - fy0) / WIDTH)) * WIDTH);
  projection.fitExtent([[6, 6], [WIDTH - 6, height - 6]], frame);
  // The map pans and zooms (MarketMap), so the outlines reach one frame past
  // each edge: dragging shows the neighbours instead of empty paper.
  const outer: Box = [[-WIDTH, -height], [2 * WIDTH, 2 * height]];
  projection.clipExtent(outer);

  // Fine outlines (50m) only for a regional frame and only for countries that
  // touch the opening view; everything reached by panning uses 110m, which
  // keeps the page payload near what the fixed map cost.
  const detail = spanX < 45 ? "50m" : "110m";
  const path = geoPath(projection).digits(1);
  const touches = (b: Box, area: Box) => !(b[1][0] < area[0][0] || b[1][1] < area[0][1] || b[0][0] > area[1][0] || b[0][1] > area[1][1]);
  const view: Box = [[0, 0], [WIDTH, height]];
  const fine = new Map<string, Feature<Geometry, { name: string }>>();
  if (detail === "50m") {
    for (const f of countries("50m")) {
      if (f.id !== undefined && touches(path.bounds(f) as Box, view)) fine.set(String(f.id), f);
    }
  }
  const out: MapCountry[] = [];
  const seen = new Set<string>();
  for (const coarse of countries("110m")) {
    const id = coarse.id === undefined ? null : String(coarse.id);
    const f = (id && fine.get(id)) || coarse;
    const d = path(f);
    if (!d) continue;
    if (!touches(path.bounds(f) as Box, outer)) continue;
    if (id) seen.add(id);
    out.push({ iso: isoOf(f), d });
  }
  // Small countries that only the 50m atlas has (Luxembourg-sized and below).
  for (const [id, f] of fine) {
    if (seen.has(id)) continue;
    const d = path(f);
    if (d) out.push({ iso: isoOf(f), d });
  }

  const labels: Record<string, [number, number]> = {};
  for (const iso of [...focus, ...extra]) {
    const f = byIso.get(iso);
    const at = LABEL_AT[iso] ? projection(LABEL_AT[iso]) : f ? path.centroid(mainPart(f)) : null;
    if (at && Number.isFinite(at[0]) && at[0] >= outer[0][0] && at[0] <= outer[1][0] && at[1] >= outer[0][1] && at[1] <= outer[1][1]) {
      labels[iso] = [Math.round(at[0] * 10) / 10, Math.round(at[1] * 10) / 10];
    }
  }

  return { width: WIDTH, height, countries: out, labels, extent: outer };
}
