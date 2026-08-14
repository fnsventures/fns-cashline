# FNS Cashline · FINDI

## A F & S Ventures Company

**FINDI** ATM float desk at **Bishnupriya Fuels Petrol Pump**, Padmanavpur — track cash drawn from the bank CC, loaded into the machine, pending cash still in hand, and (for admins) partner commission.

**Live** [`main`](https://fnscashline.fnsventures.in) · **Test** `staging` → `/staging/`

---

## Features

| Area | What it covers |
|------|----------------|
| **Home** | Pending to load, capital target, bank/ATM totals, today’s activity; commission KPIs for admin |
| **Cash** | Bank draw + ATM load with **required receipt photos**, auto time + GPS |
| **Commission** | Settlements: **txns × rate − TDS** — **admin only** |
| **Users** | Provision operators/admins + set total capital — **admin only** |
| **Reports** | Monthly printable summary |

**Roles:** `admin` (full access) · `operator` (float desk only). Enforced by Supabase RLS.

### Float math

```text
pending_to_load = max(0, sum(bank_draws) − sum(atm_loads))
```

Daily flow: **Bank CC draw → ATM load**. See the [business guide](docs/BUSINESS.md) for field-by-field ops detail.

---

## Documentation

| Document | Purpose |
|----------|---------|
| [**Business guide**](docs/BUSINESS.md) | Workflows, KPIs, roles, onboarding, receipts & GPS |
| [**Development guide**](docs/DEVELOPMENT.md) | Local setup, schema, RLS, storage, migrations, deploy wiring |
| [**Operations**](docs/OPERATIONS.md) | Staging deploy · production release |

Database: [`supabase/schema.sql`](supabase/schema.sql) · upgrades (in order):

1. [`20260808150000_findi_float_roles.sql`](supabase/migrations/20260808150000_findi_float_roles.sql)
2. [`20260808153000_receipts_and_commission_rate.sql`](supabase/migrations/20260808153000_receipts_and_commission_rate.sql)
3. [`20260808160000_bank_draw_atm_load_geo.sql`](supabase/migrations/20260808160000_bank_draw_atm_load_geo.sql)

**Deploy:** push to `staging` or `main` → GitHub Actions → GitHub Pages (`gh-pages`), with `js/env.js` built from environment secrets (same pattern as petrolPump).

---

## Getting started

```bash
cp js/env.example.js js/env.js
# Edit js/env.js with staging/prod Supabase URL + anon key

# Fresh project: run supabase/schema.sql in SQL Editor
# Existing project: run the three migration files above, in order

python3 -m http.server 8080
# Open http://localhost:8080
```

Full setup, schema map, and smoke checklist: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

---

## Related projects

| Repo | Purpose |
|------|---------|
| [petrolPump](../petrolPump) | Bishnupriya Fuels daily operations |
| [fnsventuresRoot](../fnsventuresRoot) | F & S Ventures corporate website |

---

## Contact

- WhatsApp: [+91 96689 13299](https://wa.me/919668913299)
- Email: [official@fnsventures.in](mailto:official@fnsventures.in)
