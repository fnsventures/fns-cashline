# Development Guide

Technical setup, schema, auth, storage, and page map for **FNS Cashline / FINDI**.

For day-to-day ops language (bank draw, pending to load, commission), see [BUSINESS.md](./BUSINESS.md).

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
     | 3 | `supabase/migrations/20260808160000_bank_draw_atm_load_geo.sql` | `bank_draws` table, geo columns, new `v_atm_summary` |
     | 4 | `supabase/migrations/20260808170000_foolproof_ops_rpc.sql` | RPC-only writes, server time, geo/amount locks |

   After upgrades, the live schema should match `schema.sql` (bank draws + ATM loads; no ops desk for customer withdrawals).

### Foolproof rules (database-enforced)

| Control | Behaviour |
|---------|-----------|
| Time | `recorded_at = now()` on server — client clock ignored |
| Location | GPS required; India bounds; optional station geofence |
| Amount | Must be &gt; 0 and ≤ capital; ATM load ≤ pending bank cash |
| Writes | Only via `record_bank_draw` / `record_atm_load` RPCs |
| Edits | Operators cannot update/delete past entries |

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
├── cash.html               # Bank draw + ATM load
├── commissions.html        # Admin settlements
├── users.html              # Admin: team + capital
├── reports.html            # Monthly printable report
├── assets/                 # Brand / marketing images
├── css/
│   ├── base.css
│   ├── app.css
│   ├── landing.css
│   └── login.css
├── js/
│   ├── env.example.js      # Template → copy to env.js
│   ├── env.js              # Local secrets (do not commit)
│   ├── appConfig.js        # Station defaults, nav, modes
│   ├── brand.js
│   ├── auth.js             # Session, requireAuth, topbar, roles
│   ├── supabase.js         # Client bootstrap
│   ├── receipts.js         # Upload + signed URLs
│   ├── geo.js              # Geolocation helpers
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
| `dashboard.html` | `dashboard.js` | Reads `v_atm_summary` + today’s bank/load sums |
| `cash.html` | `cash.js` + `receipts.js` + `geo.js` | Inserts into `bank_draws` / `cash_loads` |
| `commissions.html` | `commissions.js` | Admin gate in `auth.js`; writes `commission_settlements` |
| `users.html` | `users.js` | `provision_user` + `atm_settings` capital |
| `reports.html` | `reports.js` | Month filter; commission section if admin |

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
| `bank_draws` | Staff all |
| `cash_loads` | Staff all |
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

### `bank_draws`

Cash taken from bank CC.

| Column | Notes |
|--------|--------|
| `amount` | &gt; 0 |
| `reference`, `notes` | Optional |
| `receipt_path` | **Required** storage path |
| `recorded_at` | Event time (app sets ISO now) |
| `latitude`, `longitude`, `geo_accuracy_m` | Optional GPS |
| `created_by` | `users.id` |

### `cash_loads`

Cash loaded into the ATM.

| Column | Notes |
|--------|--------|
| `load_date` | Local calendar date |
| `amount` | &gt; 0 |
| `mode` | `bank_cc` \| `bank_transfer` \| `cash` \| `other` (UI currently saves `bank_cc`) |
| `atm_receipt_path` | Required in app |
| `recorded_at` + geo | Same pattern as bank draws |

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

```sql
total_bank_drawn      = sum(bank_draws.amount)
total_loaded          = sum(cash_loads.amount)
pending_to_load       = max(0, total_bank_drawn − total_loaded)
total_capital         = atm_settings.config.station.totalCapital
total_commission_net  = sum(commission_settlements.net_commission)
total_transactions    = sum(commission_settlements.transaction_count)
```

---

## 7. Receipt storage

- Bucket id/name: **`receipts`** (private)
- Max size: **5 MB**
- MIME: jpeg, jpg, png, webp, heic, heif
- Object path pattern: `{userId}/{kind}/{timestamp}-{rand}.{ext}`  
  where `kind` is `bank` or `atm` (`js/receipts.js`)
- Viewing: `createSignedUrl` (1 hour) for history tables

Ensure the migration / schema that creates the bucket and storage policies has been applied; otherwise uploads fail at runtime.

---

## 8. Geolocation

`js/geo.js` + Cash page:

- On load and before save, refresh GPS into `geoState`
- Persist `latitude`, `longitude`, `geo_accuracy_m` on insert
- If GPS missing, confirm dialog before saving without location
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
- [ ] Cash: bank draw with photo + GPS → row + pending increases  
- [ ] Cash: ATM load with photo → pending decreases  
- [ ] Home KPIs match pending / today totals  
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
