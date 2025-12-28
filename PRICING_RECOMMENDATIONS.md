# Pricing & Go-To-Market Recommendations (Global Adoption + Acquisition)

**Goal recap**
- Maximize worldwide adoption (including developing countries).
- Monetize via hosted SaaS (global AWS regions).
- Maintain a clean, acquisition-friendly business model.

---

## 1) Use a simple, transparent country-tier model
**Why:** It minimizes friction, feels fair, and is easy to explain to buyers.

**Structure:**
- **Base price** (e.g., $120/unit/year).
- **Country multiplier** based on a public, trusted index (World Bank income tiers or PPP).

**Example tiers (illustrative):**
- High-income: $120/unit/year
- Upper-middle: $80/unit/year
- Lower-middle: $50/unit/year
- Low-income: $30/unit/year

**Benefits:**
- Easy to communicate (“your price is determined by your country tier”).
- Scales globally without custom negotiation.

---

## 2) Define “unit” clearly (avoid fairness concerns)
You said a unit can be 24–75 kids. That’s a wide range, so use **one of these**:

### Option A: Unit size bands (simple)
- 1–25 kids
- 26–50 kids
- 51–75 kids

### Option B: Per-active child pricing (most fair)
- Price per active child per year (with a minimum per unit).

**Recommendation:** Start with **size bands** for simplicity, and move to per-child pricing later if needed.

---

## 3) Keep billing annual-first
**Why:** Predictable revenue, better for acquisition.

- Annual plan with a **10–20% discount**.
- Monthly plan if needed, priced higher in total.

---

## 4) Offer a lightweight hardship/NGO discount
A visible “Request a discount” option builds trust and boosts adoption in low-income regions.

---

## 5) Keep licensing permissive to maximize adoption
If your goal is the largest possible adoption, use a **permissive open-source license** (MIT or Apache-2.0) and monetize through hosting. This is also acquisition-friendly.

---

## 6) Mobile adoption strategy (React Native)
You already have a React Native app in `mobile/`. This helps adoption in regions where mobile is primary. Maintain feature parity with the web app and keep the onboarding flow fast and low-bandwidth.

---

## Suggested first public pricing table (example)
| Country tier | Unit size band | Price per unit/year |
|---|---|---|
| High-income | 1–25 kids | $120 |
| High-income | 26–50 kids | $180 |
| High-income | 51–75 kids | $240 |
| Upper-middle | 1–25 kids | $80 |
| Upper-middle | 26–50 kids | $120 |
| Upper-middle | 51–75 kids | $160 |
| Lower-middle | 1–25 kids | $50 |
| Lower-middle | 26–50 kids | $75 |
| Lower-middle | 51–75 kids | $100 |
| Low-income | 1–25 kids | $30 |
| Low-income | 26–50 kids | $45 |
| Low-income | 51–75 kids | $60 |

> Treat this as a **starting point**. Adjust after early customer feedback.

---

## Next steps to finalize pricing
1. Confirm your typical unit size distribution.
2. Decide if you want **per-unit bands** or **per-child** pricing.
3. Pick the public tier system (World Bank income tiers or PPP).
4. Publish a short, friendly pricing FAQ explaining fairness and discounts.

