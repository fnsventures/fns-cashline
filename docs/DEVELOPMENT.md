# Development Guide

Technical setup, schema, auth, storage, and page map for **FNS Cashline / FINDI**.

For day-to-day ops language (night inquiry, ATM load, pending to load, commission), see [BUSINESS.md](./BUSINESS.md).

---

## 1. Stack

| Layer | Choice |
|-------|--------|
| UI | Static HTML + CSS + vanilla JS |
| Auth / DB / Storage | [Supabase](https://supabase.com) (Postgres + Auth + Storage + RLS) |
| Local serve | Any static server (e.g. `python3 -m http.server`) |

No build step. Pages load Supabase JS from CDN and app scripts with `defer`.

---

## 2. Local development

### Prerequisites

- A Supabase project (**use staging** for local work)
- Python 3 (or another static file server)

### Setup

1. **Create `js/env.js`** (gitignored)

   ```bash
   cp js/env.example.js js/env.js
   ```

   Set:

   ```js
   window.__APP_CONFIG__ = {
     SUPABASE_URL: "https://YOUR-PROJECT-ID.supabase.co",
     SUPABASE_ANON_KEY: "your-anon-key-here",
     APP_ENV: "staging",
   };
   ```

2. **Apply database**

   - **Fresh project:** run all of [`supabase/schema.sql`](../supabase/schema.sql) in the SQL Editor.
   - **Existing project** that still has older float / withdrawal schema: run migrations **in order**:

     | Order | File | What it does |
     |-------|------|----------------|
     | 1 | `supabase/migrations/20260808150000_findi_float_roles.sql` | Roles, RLS helpers, float rename era |
     | 2 | `supabase/migrations/20260808153000_receipts_and_commission_rate.sql` | Receipts paths, commission `rate_per_txn`, storage bucket |
     | 3 | `supabase/migrations/20260808160000_bank_draw_atm_load_geo.sql` | Legacy `bank_draws` table, geo columns |
     | 4 | `supabase/migrations/20260808170000_foolproof_ops_rpc.sql` | RPC-only writes, server time, geo/amount locks |
     | 5 | `supabase/migrations/20260808180000_atm_inquiry_replenish_cycle.sql` | Night inquiry + morning ATM load cycle |
     | 6 | `supabase/migrations/20260808181000_replenish_atm_load_only.sql` | ATM-load-only replenish (no bank draw) |
     | 7 | `supabase/migrations/20260808182000_atm_inquiry_cycle_fix.sql` | Cycle form (do **not** re-run after later migrations) |
     | 8 | `supabase/migrations/20260808183000_admin_atm_load_override.sql` | Admin amount override / load without inquiry |
     | 9 | `supabase/migrations/20260808190000_atm_cycle_modular.sql` | DRY helpers (`_insert_cash_load`, `_open_inquiry`, capital room) |
     | 10 | `supabase/migrations/20260808191000_atm_cycle_bugfixes.sql` | Balance / FOUND / helper lockdown |
     | 11 | `supabase/migrations/20260808192000_grant_current_atm_balance.sql` | Grant `_current_atm_balance` for `v_atm_summary` |
     | 12 | `supabase/migrations/20260808193000_atm_cycle_hardening.sql` | Concurrent load lock, admin force rules, override tags |
     | 13 | `supabase/migrations/20260814100000_admin_delete_atm_entries.sql` | Admin delete night inquiry / ATM load RPCs |

   After upgrades, the live schema should match `schema.sql` (inquiry → ATM load cycle).

### Foolproof rules (database-enforced)

| Control | Behaviour |
|---------|-----------|
| Time | `recorded_at = now()` on server — client clock ignored |
| Location | GPS required; India bounds; optional station geofence |
| Night inquiry | Cash left ≤ opening; dispensed = opening − left; one open cycle; one inquiry per IST day |
| Morning ATM load | Amount locked to night dispensed (admins may override); ATM receipt required |
| Writes | Only via `record_atm_inquiry` / `record_replenish` RPCs |
| Edits | Operators cannot update/delete past entries; admins may delete via Cash history |

Set station GPS under **Users → Capital & geofence** (“Use my current location”).

3. **First admin**

   - Authentication → Add user (email + password)
   - SQL Editor:

     ```sql
     insert into public.users (id, email, role, display_name)
     select id, email, 'admin', 'Your Name'
     from auth.users
     where email = 'you@example.com'
     on conflict (id) do update set role = 'admin';
     ```

   Later operators: create Auth user → sign in as admin → **Users** → Add user (`provision_user` RPC).

4. **Serve**

   ```bash
   python3 -m http.server 8080
   ```

   Open `http://localhost:8080/login.html`.

---

## 3. Project structure

```
fns-cashline/
├── .github/workflows/
│   └── deploy-pages.yml    # GitHub Pages: staging + prod
├── index.html              # Public FINDI landing
├── login.html
├── dashboard.html          # Home / KPIs
├── cash.html               # Night inquiry + ATM load
├── commissions.html        # Admin settlements
├── users.html              # Admin: team + capital
├── reports.html            # Daily / monthly / commission printable reports
├── assets/                 # Brand / marketing images
├── css/
│   ├── base.css
│   ├── app.css
│   ├── landing.css
│   └── login.css
├── js/
│   ├── env.example.js      # Template → copy to env.js
│   ├── env.js              # Local secrets (do not commit)
│   ├── appConfig.js        # Station defaults, nav, RPC/receipt constants
│   ├── brand.js
│   ├── auth.js             # Session, requireAuth, topbar, roles
│   ├── supabase.js         # Client bootstrap
│   ├── receipts.js         # Upload + signed URLs
│   ├── geo.js              # Geolocation helpers
│   ├── atmCycle.js         # Shared inquiry/load read model
│   ├── opsSubmit.js        # Shared receipt + RPC submit helper
│   ├── cash.js
│   ├── dashboard.js
│   ├── commissions.js
│   ├── users.js
│   ├── reports.js
│   └── utils.js
└── supabase/
    ├── schema.sql          # Canonical full schema (fresh install)
    └── migrations/         # Ordered upgrades for existing DBs
```

---

## 4. Pages ↔ scripts

| Page | Primary script | Notes |
|------|----------------|-------|
| `dashboard.html` | `dashboard.js` + `atmCycle.js` | Reads `v_atm_summary` — next action + cash location |
| `cash.html` | `cash.js` + `atmCycle.js` + `opsSubmit.js` + `receipts.js` + `geo.js` | RPCs: `record_atm_inquiry` / `record_replenish` |
| `commissions.html` | `commissions.js` | Admin settlements form + monthly/YTD track |
| `users.html` | `users.js` | `provision_user` + `atm_settings` capital |
| `reports.html` | `reports.js` + `atmCycle.js` | Daily dispensed track, monthly rollup, commission year track (admin) |

Shared: `env.js` → `supabase.js` → `auth.js` → page script. Nav items and role visibility live in `appConfig.js` (`NAV_ITEMS`).

---

## 5. Auth, roles & RLS

### Roles

| Role | DB check | App access |
|------|----------|------------|
| `operator` | `public.users.role` | Home, Cash, Reports |
| `admin` | `public.users.role` | + Commission, Users, capital write |

Helpers (security definer):

- `get_my_role()` — current user’s role
- `is_admin()` — role = admin
- `is_staff()` — admin or operator

### Policies (summary)

| Table / bucket | Who |
|----------------|-----|
| `users` | Select own row; admin select/update all |
| `atm_settings` | Staff select; admin write |
| `bank_draws` | **Legacy** — staff select; admin delete (no app writes) |
| `cash_loads` | Staff select; writes via `record_replenish` only |
| `atm_inquiries` | Staff select; writes via `record_atm_inquiry` only |
| `commission_settlements` | Admin all |
| `v_atm_summary` | `grant select` to authenticated (view uses `security_invoker`) |
| Storage `receipts` | Staff select/insert/update; insert path must start with `auth.uid()`; delete own or admin |

### Provisioning operators

```text
Supabase Auth: create email/password user
        ↓
Admin opens Users → Add user
        ↓
RPC provision_user(email, role, display_name)
        ↓
Row in public.users linked to auth.users.id
```

`provision_user` fails if there is no Auth user for that email (by design).

---

## 6. Data model

### `users`

App profile linked 1:1 to `auth.users`. Roles: `admin` | `operator`.

### `atm_settings`

Single row (`id = 1`). JSON `config.station` includes:

| Key | Meaning | Default (schema) |
|-----|---------|------------------|
| `displayName` | Brand label | FINDI |
| `location` | Site | Bishnupriya Fuels… |
| `franchisePartner` | Partner | FINDI |
| `machineId` | Optional machine id | `""` |
| `totalCapital` | Capital target (₹) | `200000` |
| `commissionPerTxn` | Default rate hint | `0` |
| `minFloat` | Reserved | `0` |

Users page updates `totalCapital` (and preserves other station keys).

### `bank_draws` (legacy)

Historical bank CC draws. **Not used by the app** after the inquiry → ATM load cycle. Table kept for old rows; `record_bank_draw` execute is revoked.

### `atm_inquiries`

Night ATM inquiry (cycle open until morning load).

| Column | Notes |
|--------|--------|
| `inquiry_date` | IST calendar day; unique |
| `opening_balance` | From `_current_atm_balance()` / capital |
| `cash_left` | Closing balance from machine |
| `dispensed` | `opening − cash_left` |
| `receipt_path` | Required inquiry slip |
| `replenished_at` | Set when morning load closes the cycle |
| `recorded_at` + geo | Server time; GPS required |

### `cash_loads`

Cash loaded into the ATM (morning step).

| Column | Notes |
|--------|--------|
| `load_date` | IST calendar date |
| `amount` | Locked to night dispensed (admins may override) |
| `mode` | Always `bank_cc` today (`AppConfig.ATM_LOAD_MODE`) |
| `atm_receipt_path` | Required |
| `inquiry_id` | FK to night inquiry; null for admin orphan loads |
| `recorded_at` + geo | Server time; GPS required |

### `commission_settlements` (admin)

| Column | Notes |
|--------|--------|
| `period_start` / `period_end` | Inclusive range; end ≥ start |
| `transaction_count` | ≥ 0 |
| `rate_per_txn` | Optional; ≥ 0 |
| `gross_commission` | App: txns × rate |
| `tds` | Tax deducted |
| `net_commission` | App: gross − tds |
| `paid_on`, `reference`, `notes` | Optional |

### `v_atm_summary`

Inquiry-driven read model (via `_current_atm_balance()`):

```text
cash_in_atm         = open.cash_left, or last closed + loads (+ orphan admin loads)
pending_replenish   = open inquiry dispensed (0 if none)
pending_to_load     = alias of pending_replenish (compat)
total_capital       = atm_settings.config.station.totalCapital
open_inquiry_*      = fields from the open cycle row
total_dispensed     = sum(atm_inquiries.dispensed)
total_loaded        = sum(cash_loads.amount)
total_bank_drawn    = sum(bank_draws) — legacy column
total_commission_*  = commission rollups
```

Active write RPCs: `record_atm_inquiry`, `record_replenish` (optional `p_amount`, `p_force` for admins).
Admin delete RPCs: `admin_delete_atm_inquiry`, `admin_delete_cash_load` (tip of inquiry chain only; deleting a load reopens its linked inquiry).

Shared helpers: `_validate_*`, `_current_atm_balance`, `_atm_opening_balance`, `_open_inquiry`, `_insert_cash_load`.
---

## 7. Receipt storage

- Bucket id/name: **`receipts`** (private)
- Max size: **5 MB**
- MIME: jpeg, jpg, png, webp, heic, heif
- Object path pattern: `{userId}/{kind}/{timestamp}-{rand}.{ext}`  
  where `kind` is `inquiry` or `atm` (`AppConfig.RECEIPT_KINDS` / `js/receipts.js`)
- Viewing: `createSignedUrl` (1 hour) for history tables

Ensure the migration / schema that creates the bucket and storage policies has been applied; otherwise uploads fail at runtime.

---

## 8. Geolocation

`js/geo.js` + Cash page:

- On load and before save, refresh GPS into `geoState`
- Persist `latitude`, `longitude`, `geo_accuracy_m` via RPCs
- GPS is **required** (save blocked until location is available)
- History shows formatted coords + optional Google Maps link

Serve over `localhost` or HTTPS so browsers allow geolocation.

---

## 9. Environment & secrets

| File | Commit? |
|------|---------|
| `js/env.example.js` | Yes |
| `js/env.js` | **No** |

Use the **anon** key only in the browser. All sensitive access is gated by RLS. Separate Supabase projects for staging and production.

---

## 10. Deployment (prod and staging)

Same pattern as [petrolPump](../../petrolPump): GitHub Actions publishes static files to **GitHub Pages**, generating `js/env.js` from environment secrets.

Day-to-day steps: **[Operations playbook](OPERATIONS.md)**.

| Environment | Branch   | Typical URL |
|-------------|----------|-------------|
| **Production** | `main`   | `https://fnscashline.fnsventures.in/` |
| **Staging**    | `staging` | `https://fnscashline.fnsventures.in/staging/` |

### 10.1 How it works

Workflow: [`.github/workflows/deploy-pages.yml`](../.github/workflows/deploy-pages.yml).

| Trigger | What happens |
|---------|----------------|
| Push to **`staging`** | Deploy that commit to **staging** (`/staging/`) |
| Push to **`main`** | Deploy that commit to **prod** (root) |
| **Manual** (Actions → Deploy → Run workflow) | Deploy any branch/tag/commit to **staging** or **prod** |

Each deploy uses that environment’s GitHub secrets and pushes to **`gh-pages`** (staging → `/staging/` only; prod → root, staging preserved). There is **no npm build** — the site is plain static HTML/JS.

### 10.2 Required GitHub configuration

1. **GitHub Pages source:** Settings → Pages → Build and deployment → **Deploy from a branch** → Branch **`gh-pages`** → **`/ (root)`**.
2. Create two **environments**: **prod** and **staging** (Settings → Environments).
3. In each environment, add **Environment secrets**:
   - `SUPABASE_URL` — Supabase project URL for that environment
   - `SUPABASE_ANON_KEY` — Supabase anon (public) key for that environment
4. Use **`main`** as the default branch (rename from `master` if needed) and keep a long-lived **`staging`** branch.
5. Custom domain: root [`CNAME`](../CNAME) is `fnscashline.fnsventures.in` (removed under `/staging/` on staging deploys). DNS + Pages steps: [OPERATIONS.md](OPERATIONS.md).

### 10.3 Per-environment database

On **each** Supabase project (staging and prod):

1. Apply `schema.sql` (fresh) or the ordered migrations (existing)
2. Confirm Storage bucket `receipts` exists and policies are present
3. Seed first admin as in §2

---

## 11. Smoke test checklist

After schema + env:

- [ ] Login as admin  
- [ ] Users: set capital; provision an operator  
- [ ] Cash: night inquiry with closing balance + slip + GPS → open cycle / pending increases  
- [ ] Cash: ATM load with photo → cycle closes / pending clears  
- [ ] Admin: override load amount or load without inquiry  
- [ ] Home KPIs match pending / cash in ATM  
- [ ] Commission: save settlement; appears on Home admin panel  
- [ ] Logout → login as operator: no Commission / Users nav; commission RLS blocks direct table access  
- [ ] Reports: month print view loads  

---

## 12. Related docs

| Doc | Audience |
|-----|----------|
| [BUSINESS.md](./BUSINESS.md) | Franchise / operators — workflows & KPIs |
| [OPERATIONS.md](./OPERATIONS.md) | Staging deploy · production release |
| [README.md](../README.md) | Repo overview & quick start |
| [`supabase/schema.sql`](../supabase/schema.sql) | Canonical database |
