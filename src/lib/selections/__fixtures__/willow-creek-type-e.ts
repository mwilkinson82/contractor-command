import type { Board, Option } from "../model";

/**
 * TEST FIXTURE. Job 2810 (Willow Creek Community Center, Electrical), takeoff
 * line T-1: Type E 24x48 lay-in LED fixtures, 6 ea on E1 (A4.1 shows 7; the
 * takeoff carries the conflict for review). Products, links and listed prices
 * were read on public product pages on 2026-11-04. Costs, customer prices and
 * the base price are illustrative only, not ALP's numbers.
 */
const option = (o: Partial<Option>): Option => ({
  description: "",
  manufacturer: "",
  model: "",
  specifications: "",
  included: [],
  source_url: null,
  photo_url: null,
  found_price_cents: null,
  found_at: "",
  found_on: null,
  cost_cents: null,
  price_cents: null,
  price_reviewed_on: null,
  assumptions: "",
  ...o,
});

export const TYPE_E_ID = "6f1d2c34-8b1a-4f0e-9c4d-2a7b5e9d1c01";

export function willowCreekTypeE(reviewed = true): Board {
  const on = reviewed ? "2026-11-04" : null;
  return {
    currency: "USD",
    proposal: {
      title: "Willow Creek lighting options",
      intro: "Choose the lay-in light fixture package for the community center.",
      base_price_cents: 4_850_000,
      base_tier: "good",
      base_reviewed_on: on,
      base_basis: "Illustrative test base price",
      valid_until: "2026-12-04",
      terms: "Prices include installation of the fixtures shown. Exclusions per the base proposal.",
    },
    selections: [
      {
        id: TYPE_E_ID,
        title: "Type E 2x4 lay-in LED fixtures",
        decision_due: "2026-11-20",
        allowance_cents: null,
        quantity: 6,
        unit: "ea",
        estimate_line_ref: "T-1",
        options: {
          good: option({
            description: "2x4 LED flat panel, 4000K, 4,500 lumens",
            manufacturer: "Commercial Electric",
            model: "FP24484045TDCEV",
            specifications: "4,500 lumens · 4000K · dimmable · ETL listed",
            included: ["Fixture and installation", "Standard dimming"],
            source_url:
              "https://homedepot.com/p/Commercial-Electric-2-ft-x-4-ft-LED-Flat-Panel-40K-4500-Lumens-Standard-Dimming-FP24484045TDCEV/328588994",
            photo_url:
              "https://images.thdstatic.com/productImages/82f96079-997a-4092-858d-2120b4f5b3b8/svn/white-commercial-electric-panel-and-troffer-lights-fp24484045tdcev-64_1000.jpg",
            found_price_cents: 6997,
            found_at: "Home Depot online list price",
            found_on: "2026-11-04",
            cost_cents: 6997,
            price_cents: 9800,
            price_reviewed_on: on,
            assumptions: "Retail list price; no distributor quote yet.",
          }),
          better: option({
            description: "2x4 LED flat panel with selectable lumens and color",
            manufacturer: "Lithonia Lighting",
            model: "CPANL 2X4 ALO6 SWW7 M2",
            specifications: "4,000/5,000/6,000 lumens selectable · selectable color temperature · 0-10V dimming to 10% · 5-year warranty",
            included: ["Fixture and installation", "0-10V dimming", "5-year warranty"],
            source_url: "https://www.homedepot.com/p/p/318318625",
            photo_url:
              "https://images.thdstatic.com/productImages/6b576cf4-beb8-430c-8ab5-164f12d6e0bf/svn/white-lithonia-lighting-panel-and-troffer-lights-cpanl-2x4-alo6-sww7-m2-64_1000.jpg",
            found_price_cents: 10999,
            found_at: "Home Depot online list price",
            found_on: "2026-11-04",
            cost_cents: 10999,
            price_cents: 15400,
            price_reviewed_on: on,
          }),
          best: option({
            description: "Architectural basket troffer, 90+ CRI, wireless sensor",
            manufacturer: "Lithonia Lighting",
            model: "2BLT4 40L ADPT EZ1 LP940 NLTAIR2 RES7PDT",
            specifications: "4,000 lumens · 32W · 4000K · 90+ CRI · dims to 1% · nLight AIR wireless sensor",
            included: ["Fixture and installation", "Dimming to 1%", "Built-in occupancy and daylight sensor"],
            source_url:
              "https://www.platt.com/p/1845879/lithonia-lighting/basket-led-lensed-troffer-2x4/193047763523/lit2blt440l940",
            photo_url: null,
            found_price_cents: 27133,
            found_at: "Platt list price",
            found_on: "2026-11-04",
            cost_cents: 27133,
            price_cents: 37900,
            price_reviewed_on: on,
            assumptions: "Sensor commissioning by ALP; confirm nLight programming time.",
          }),
        },
        selected: null,
        notes: "E1 lists 6, A4.1 shows 7. Confirm count before award.",
      },
    ],
    accepted: null,
  };
}
