# FINDI Cashline — Business Guide

F & S Ventures · FINDI ATM franchise · Bishnupriya Fuels Petrol Pump, Padmanavpur

This guide explains how the float desk works day to day: what you record, why, and how numbers on Home / Cash / Commission relate to real cash movement.

---

## 1. What this app is for

**FNS Cashline** is the ops desk for the **FINDI** ATM at Bishnupriya Fuels.

It does **not** track every customer withdrawal from the machine. FINDI / the network already covers that side. This app tracks **your** cash movement:

1. Cash taken from the **bank credit card (CC)**
2. That same cash **loaded into the FiNDi ATM**
3. How much bank cash is still **pending to load**
4. Your **total capital** target for the franchise
5. **Commission** settlements from the partner (**admin only**)

```
    Bank CC                          FiNDi ATM
       │                                  │
       │  1. Bank draw                    │
       │  (receipt + time + GPS)          │
       ├──────────► Cash in hand ─────────┤
       │                                  │  2. ATM load
       │                                  │  (receipt + time + GPS)
       │                                  ▼
       │                            Machine float
```

---

## 2. The daily workflow

### Step A — Bank draw

When you withdraw cash from the bank CC to refill the ATM:

| Field | Required? | Notes |
|-------|-----------|--------|
| Amount (₹) | Yes | Exact amount drawn |
| Reference | No | UTR / slip number |
| Bank receipt photo | **Yes** | Camera / gallery; stored privately |
| Time | Auto | Captured at save |
| Location (GPS) | Preferred | Captured at save; you can confirm if GPS fails |

**Meaning:** money left the bank and is now **in hand** (or in transit to the pump), not yet in the ATM.

### Step B — ATM load

When you put that cash into the FiNDi machine:

| Field | Required? | Notes |
|-------|-----------|--------|
| Amount (₹) | Yes | Amount loaded into the ATM |
| Reference | No | Optional slip / journal ref |
| ATM receipt photo | **Yes** | Machine / load slip photo |
| Time | Auto | Captured at save |
| Location (GPS) | Preferred | Captured at save |

**Meaning:** cash has moved from hand into the machine.

### Order of operations

Ideal day:

1. Draw from bank → save **Bank draw** with receipt  
2. Load into ATM → save **ATM load** with receipt  
3. Check **Pending to load** goes toward ₹0  

If you load more than currently pending, the app warns and asks you to confirm (allowed for corrections / edge cases).

---

## 3. Core formulas

| Metric | Formula | Plain meaning |
|--------|---------|----------------|
| **Total bank drawn** | Sum of all bank draws | Lifetime cash taken from CC for this desk |
| **Total loaded** | Sum of all ATM loads | Lifetime cash put into the machine |
| **Pending to load** | max(0, bank drawn − ATM loaded) | Cash drawn but not yet loaded |
| **Total capital** | Set by admin (Users page) | Franchise capital target (e.g. ₹2,00,000) |
| **Net commission** | Sum of settlement nets | Partner payouts recorded by admin |

**Pending to load** is the main operational KPI. If it is above zero, cash is still outside the ATM after a bank draw.

Operators cannot fake time, skip GPS, or load more than pending bank cash — those rules are enforced in the database, not only in the phone UI.

**Total capital** is a planning / franchise target. It is shown on Home so everyone knows the intended float size; it is not recalculated from customer withdrawals.

---

## 4. Screens and who uses them

| Screen | Operator | Admin | Purpose |
|--------|----------|-------|---------|
| **Home** | ✓ | ✓ | Pending to load, capital, totals, today’s bank/load; commission KPIs for admin |
| **Cash** | ✓ | ✓ | Record bank draws and ATM loads; see recent rows + receipts |
| **Commission** | — | ✓ | Enter settlements: txns × rate − TDS |
| **Users** | — | ✓ | Provision team roles; set total capital |
| **Reports** | ✓ | ✓ | Monthly printable summary (commission block admin-only) |

### Roles in one line

- **Operator** — run the float desk (Home, Cash, Reports). Cannot see or edit commission or users.  
- **Admin** — everything operators can do, plus commission, users, and capital.

Access is enforced in the database (Row Level Security), not only by hiding menu items.

---

## 5. Commission (admin)

Commission is **not** inferred from ATM loads. It is entered when the partner settles:

```
gross = transaction_count × rate_per_txn
net   = gross − TDS
```

You record:

- Settlement period (start / end)
- Transaction count
- Rate per transaction (₹)
- TDS (if any)
- Paid-on date, reference, notes (optional)

Operators never see Commission or commission totals on Home / Reports.

---

## 6. Receipts, time, and location

Every bank draw and ATM load is meant to be **audit-ready**:

| Capture | Why |
|---------|-----|
| **Photo** | Proof of the bank slip or ATM load slip |
| **Timestamp** | When the desk recorded the event |
| **GPS** | Rough place of capture (maps link in history) |

Photos are stored in a private Supabase Storage bucket (`receipts`). Staff can view signed links in the Cash history tables. Files are limited to common image types and **5 MB**.

If GPS cannot be captured (permissions / indoor), the app asks whether to save without location. Prefer enabling location for foolproof records.

---

## 7. KPIs on Home

| KPI | Who sees it | Source |
|-----|-------------|--------|
| Pending to load | Everyone | `bank_draws − cash_loads` |
| Total capital | Everyone | Users → Total capital |
| Total bank drawn | Everyone | Sum of bank draws |
| Total ATM loaded | Everyone | Sum of ATM loads |
| Bank drawn today | Everyone | Bank draws with `recorded_at` today |
| ATM loaded today | Everyone | ATM loads with `recorded_at` today |
| Net commission (all time) | Admin | Sum of settlement nets |
| Total transactions (settled) | Admin | Sum of settlement txn counts |

Pending callout turns urgent when pending &gt; 0, and clear when pending is ₹0.

---

## 8. Monthly reports

**Reports** builds a printable month view:

- Pending / capital / bank / loaded (and commission for admin)
- Bank draw and ATM load line items for the selected month
- Commission settlements overlapping that month (admin)

Use it for month-end review or sharing a paper/PDF print with the franchise owner.

---

## 9. Onboarding checklist

- [ ] FINDI franchise live at Bishnupriya Fuels  
- [ ] Admin account created in Supabase Auth and linked in `public.users` with role `admin`  
- [ ] Set **total capital** on Users  
- [ ] Create operator Auth logins, then provision them on Users → Add user  
- [ ] Agree commission rate and settlement cycle with FINDI / partner  
- [ ] Train operators: bank draw → ATM load, always with receipt photos and location on  
- [ ] Record first bank draw and first ATM load; confirm pending behaves as expected  

---

## 10. What we deliberately do not track here

| Not in this app | Why |
|-----------------|-----|
| Per-customer ATM withdrawals | Handled by FINDI / network reporting |
| Bank CC balance or statements | Use the bank app; we only log draws you make for the ATM |
| Petrol pump day book | Separate product: petrolPump |

If you need customer-withdrawal float math again, that would be a product change — the current desk is **bank CC → ATM load** only.
