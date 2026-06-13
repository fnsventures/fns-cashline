# Development Guide

---

## 1. Local development

### Prerequisites

- A [Supabase](https://supabase.com) project (free tier is enough to start)
- Python 3 or any static file server

### Setup

1. **Clone / open this repo**

2. **Create `js/env.js`** from the template:

   ```bash
   cp js/env.example.js js/env.js
   ```

   Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` from Supabase → Project Settings → API.

3. **Apply the database schema**

   In Supabase → SQL Editor, run the full contents of `supabase/schema.sql`.

4. **Create your admin user**

   - Supabase → Authentication → Add user (email + password)
   - Copy the user’s UUID
   - SQL Editor:

     ```sql
     insert into public.users (id, email, role, display_name)
     values ('<auth-user-uuid>', 'you@example.com', 'admin', 'Your Name');
     ```

5. **Serve the site**

   ```bash
   python3 -m http.server 8080
   ```

   Open `http://localhost:8080` → Login.

---

## 2. Project structure

```
fns-cashline/
├── index.html           # Public landing
├── login.html           # Supabase Auth login
├── dashboard.html       # Snapshot KPIs
├── cash-loads.html      # Load + settlement entries
├── commissions.html     # Commission settlements
├── reports.html         # Printable monthly summary
├── css/                 # base, app, login, landing
├── js/                  # Page scripts + shared auth/utils
└── supabase/
    └── schema.sql       # Tables, RLS, views
```

---

## 3. Database tables

| Table | Purpose |
|-------|---------|
| `users` | App operators linked to Supabase Auth |
| `atm_settings` | Franchise partner, machine ID, default rates |
| `cash_loads` | Cash loaded into the ATM |
| `cash_settlements` | Cash returned / swept by partner |
| `commission_settlements` | Monthly commission lines |

View `v_atm_summary` aggregates deployed cash and commission totals.

---

## 4. Deployment (optional)

Same pattern as [petrolPump](../petrolPump):

1. Host static files on GitHub Pages
2. Generate `js/env.js` in CI from GitHub Secrets
3. Point a subdomain (e.g. `atm.bishnupriyafuels.fnsventures.in`) via DNS + CNAME

---

## 5. Adding operators

Only `admin` role is used initially. To add another admin:

1. Create user in Supabase Auth
2. Insert row in `public.users` with `role = 'admin'`
