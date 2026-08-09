# FNS Cashline · FINDI

## A F & S Ventures Company

**FINDI** ATM float desk at **Bishnupriya Fuels Petrol Pump**, Padmanavpur — night ATM inquiry (cash left), morning ATM load to replenish customer withdrawals, and (for admins) partner commission.

**Live** [`main`](https://fnscashline.fnsventures.in) · **Test** `staging` → `/staging/`

---

## Features

| Area | What it covers |
|------|----------------|
| **Home** | Trading account + cash in ATM = capital; open cycle / ATM load due |
| **Cash** | Night ATM inquiry + morning ATM load (amount locked; admin override) |
| **Commission** | Settlements: **txns × rate − TDS** — **admin only** |
| **Users** | Provision operators/admins + set total capital — **admin only** |
| **Reports** | Monthly printable summary |

**Roles:** `admin` (full access) · `operator` (float desk only). Enforced by Supabase RLS.

### Float math

```text
dispensed          = opening_balance − cash_left   (night inquiry)
pending_replenish  = open inquiry dispensed
trading_account    = total_capital − cash_in_atm
```

Daily flow: **Night inquiry → morning ATM load (exact dispensed)**. See the [business guide](docs/BUSINESS.md) for field-by-field ops detail.

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
4. [`20260808170000_foolproof_ops_rpc.sql`](supabase/migrations/20260808170000_foolproof_ops_rpc.sql)
5. [`20260808180000_atm_inquiry_replenish_cycle.sql`](supabase/migrations/20260808180000_atm_inquiry_replenish_cycle.sql)
6. [`20260808181000_replenish_atm_load_only.sql`](supabase/migrations/20260808181000_replenish_atm_load_only.sql)
7. [`20260808182000_atm_inquiry_cycle_fix.sql`](supabase/migrations/20260808182000_atm_inquiry_cycle_fix.sql)
8. [`20260808183000_admin_atm_load_override.sql`](supabase/migrations/20260808183000_admin_atm_load_override.sql) — admin load overrides
9. [`20260808190000_atm_cycle_modular.sql`](supabase/migrations/20260808190000_atm_cycle_modular.sql) — modular helpers (canonical with `schema.sql`)
10. [`20260808191000_atm_cycle_bugfixes.sql`](supabase/migrations/20260808191000_atm_cycle_bugfixes.sql) — balance / capital-room sync

**Deploy:** push to `staging` or `main` → GitHub Actions → GitHub Pages (`gh-pages`), with `js/env.js` built from environment secrets (same pattern as petrolPump).

---

## Getting started

```bash
cp js/env.example.js js/env.js
# Edit js/env.js with staging/prod Supabase URL + anon key

# Fresh project: run supabase/schema.sql in SQL Editor
# Existing project: run migration files above, in order

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
