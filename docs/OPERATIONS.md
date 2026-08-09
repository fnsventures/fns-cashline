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

### DNS safety net (`fnsventures.in`)

This zone hosts **multiple** GitHub Pages apps. **Adding `fnscashline` must never remove sibling CNAMEs.** The UI distinguishes unreachable `js/env.js` (DNS/network) from a truly missing config.

| Host (CNAME) | Target | App / repo |
|--------------|--------|------------|
| `bishnupriyafuels` | `fnsventures.github.io` | Station app (`petrolpump`) |
| `fnscashline` | `fnsventures.github.io` | This app (`fns-cashline`) |

**Registrar (GoDaddy):**

- [ ] Account has **2FA** enabled
- [ ] Domain / security **alerts** enabled for the account email
- [ ] Before editing DNS: screenshot or export the DNS table
- [ ] After editing: **add** a new row only — do not overwrite sibling hosts
- [ ] **API auto-fix:** hourly schedule + secrets live on **`petrolpump`**. Optional repo secrets here for manual Actions runs:
  - `GODADDY_API_KEY`
  - `GODADDY_API_SECRET`

**After any DNS change**, verify every sibling:

```bash
./scripts/check-dns-siblings.sh           # downloads canonical script from petrolpump main
./scripts/check-dns-siblings.sh --fix     # restore missing/wrong CNAMEs via GoDaddy, then recheck
```

Or open:

- `https://bishnupriyafuels.fnsventures.in/js/env.js`
- `https://fnscashline.fnsventures.in/js/env.js`

**Automated:** The **hourly** check runs only in `petrolpump` (shared reusable workflow + canonical script). This repo’s **Check DNS siblings** Action is **manual only** and calls that reusable workflow. A restore opens a GitHub issue and writes a job summary. Auto-fix is **DNS only** — a bad `/js/env.js` still needs Actions → **Deploy** → `prod`. Add new hosts in **petrolpump** `scripts/check-dns-siblings.sh` only.

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

---

## Common problems

| Problem | Fix |
|---------|-----|
| Banner: cannot reach `js/env.js` / DNS | Run `./scripts/check-dns-siblings.sh --fix` or wait for petrolpump hourly Action; hard-refresh |
| Banner: missing config / copy `env.example.js` | Real missing env — local copy or Deploy prod |
| Staging shows wrong Supabase project | GitHub **staging** secrets `SUPABASE_URL` / `SUPABASE_ANON_KEY` |
| Live site unchanged after merge | Wait for Actions **Deploy**; hard-refresh |
