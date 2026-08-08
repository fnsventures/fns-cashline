# Operations playbook

Simple steps for **deploy** and **release**. Same pattern as [petrolPump](../../petrolPump/docs/OPERATIONS.md).

---

## Before you start (one-time)

| Name | Meaning |
|------|---------|
| **Production** | Live desk + live database. Branch: `main`. |
| **Staging** | Test copy. Branch: `staging`. URL ends with `/staging/`. |
| **Frontend** | Static HTML/JS on GitHub Pages (`gh-pages`). |
| **Database** | Supabase Postgres — **separate** projects for prod and staging. |

Important:

- Pushing code does **not** copy the database.
- Applying SQL migrations does **not** deploy the website.

### GitHub setup

1. **Pages:** Settings → Pages → Deploy from a branch → **`gh-pages`** → `/ (root)`.
2. Create environments **`prod`** and **`staging`** (Settings → Environments).
3. In each environment, add secrets:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
4. Default branch should be **`main`** (rename from `master` if needed). Create a **`staging`** branch from `main`.
5. Custom domain (same pattern as petrolPump):
   - Repo has root [`CNAME`](../CNAME) → `fnscashline.fnsventures.in`
   - DNS at your registrar: **CNAME** host `fnscashline` → `fnsventures.github.io`
   - GitHub → Settings → Pages → Custom domain → `fnscashline.fnsventures.in` → Enforce HTTPS
   - Staging deploys strip `CNAME` under `/staging/` only; prod keeps the root file

---

## 1. Deploy the website to staging

1. Merge or push to the `staging` branch.
2. Wait for Actions → **Deploy** (about 1 minute).
3. Open `https://fnscashline.fnsventures.in/staging/` and test.

**Manual:** Actions → **Deploy** → Run workflow → target `staging`.

---

## 2. Release to production

Do these **in order**.

```
Code on staging  →  test on /staging/
        ↓
Database migrate (only if schema changed)
        ↓
Merge staging → main  →  live website
```

### Step A — Test on staging

Push to `staging`, confirm the desk works against the **staging** Supabase project.

### Step B — Migrate databases (if schema changed)

Run new files under `supabase/migrations/` in the SQL Editor on **staging first**, then **prod**. Fresh projects can use `supabase/schema.sql` instead.

### Step C — Merge to production

1. Open a PR: `staging` → `main` (or merge locally).
2. Merge when green.
3. Wait for Actions → **Deploy** (prod → site root).
4. Smoke-test login, cash entry, and (as admin) users/commission.

**Manual prod deploy:** Actions → **Deploy** → Run workflow → target `prod`.

---

## Manual deploy (any ref)

1. Actions → **Deploy** → **Run workflow**
2. **Use workflow from** — branch that has the workflow file (usually `main` or `staging`)
3. **target** — `staging` or `prod`
4. **ref** *(optional)* — branch, tag, or SHA to publish

Each run uses that environment’s secrets and updates **`gh-pages`** only (staging → `/staging/`; prod → root, staging folder preserved).
