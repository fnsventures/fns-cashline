# FNS Cashline

## A F & S Ventures Company

**FNS Cashline** is the cash-franchise operations desk for **F & S Ventures** — track float loading, commission settlements, and profitability for ATM and other cash-based franchises (starting at Bishnupriya Fuels).

You load cash into the ATM machine; the franchise partner (bank / WLA operator) pays you commission per transaction and settles unused cash back to your account. This app keeps those flows in one place.

---

## Features

| Area | What it covers |
|------|----------------|
| **Dashboard** | Cash deployed, loads this month, commission earned, quick snapshot |
| **Cash loads** | Record each refill (date, amount, mode, bank reference) |
| **Cash settlements** | Record cash returned by the franchise partner |
| **Commissions** | Monthly settlement lines (txn count, gross, TDS, net) |
| **Reports** | Printable monthly summary for reconciliation |

**Roles:** `admin` (full access). Authorization is enforced by Supabase Row Level Security (RLS).

---

## Business model (India)

Typical ATM franchise at a petrol pump:

1. **Space** — You provide a secure spot on the forecourt (often 25–50 sq ft).
2. **Cash loading** — You fund the ATM cassette; the partner may require a minimum float (e.g. ₹5–10 lakh).
3. **Commission** — Paid per withdrawal (e.g. ₹8–15 per txn) or as a monthly settlement.
4. **Settlement** — Unused cash is swept back to your bank; commission is credited separately (TDS may apply).

See [docs/BUSINESS.md](docs/BUSINESS.md) for partner onboarding checklist and KPIs.

---

## Documentation

| Document | Purpose |
|----------|---------|
| [**Business guide**](docs/BUSINESS.md) | Franchise model, onboarding, commission math |
| [**Development guide**](docs/DEVELOPMENT.md) | Local setup, Supabase, deployment |

Database reference: `supabase/schema.sql`.

---

## Getting started

```bash
# 1. Copy env template
cp js/env.example.js js/env.js
# Edit js/env.js with your Supabase URL and anon key

# 2. Apply schema in Supabase SQL editor
#    Run supabase/schema.sql

# 3. Serve locally
python3 -m http.server 8080
# Open http://localhost:8080
```

Full setup: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

---

## Related projects

| Repo | Purpose |
|------|---------|
| [petrolPump](../petrolPump) | Bishnupriya Fuels daily operations (DSR, credit, billing, HR) |
| [fnsventuresRoot](../fnsventuresRoot) | F & S Ventures corporate website |

---

## Contact

- WhatsApp: [+91 96689 13299](https://wa.me/919668913299)
- Email: [official@fnsventures.in](mailto:official@fnsventures.in)
