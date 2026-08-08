# FINDI Cashline — Business Guide

F & S Ventures · FINDI ATM franchise · Bishnupriya Fuels Petrol Pump, Padmanavpur

---

## 1. What this app is for

**FNS Cashline** tracks the **night inquiry → morning ATM load** cycle:

1. **Night** — ATM inquiry: cash left in the machine (inquiry slip photo)
2. **System** — customer withdrawn = opening balance − cash left
3. **Morning** — load that exact amount into the ATM (load receipt)
4. **Capital** — trading account + cash in ATM = total capital
5. **Commission** — partner settlements (**admin only**)

Bank draws are **not** tracked in the app.

```
    FiNDi ATM
       │
       │  1. Night inquiry (cash left + slip)
       │  dispensed = opening − left
       │
       │  2. Morning ATM load (exact dispensed + receipt)
       ▼
  Float restored to opening
```

---

## 2. Daily workflow

### Step A — Night ATM inquiry

| Field | Required? | Notes |
|-------|-----------|--------|
| Cash left in ATM (₹) | Yes | From ATM inquiry screen |
| Inquiry slip photo | **Yes** | Stored privately |
| Time / GPS | Auto | Server time; GPS required |

**Meaning:** customers withdrew `opening − cash left` today. That amount is due tomorrow morning.

### Step B — Morning ATM load

| Field | Required? | Notes |
|-------|-----------|--------|
| Amount | Locked | Equals last night’s dispensed (admins may override) |
| ATM load receipt photo | **Yes** | Machine load slip |
| Time / GPS | Auto | Server time; GPS required |

**Meaning:** cash loaded into the ATM restores the float to opening balance. Bank draws are not recorded here.

### Order

1. Night: save **ATM inquiry**  
2. Morning: save **ATM load** (operators: amount locked; admins may override)  
3. Dashboard shows **Due to load** until morning is done  

One open cycle at a time. One inquiry per calendar day (IST).

---

## 3. Core formulas

| Metric | Formula | Plain meaning |
|--------|---------|----------------|
| **Opening balance** | After last ATM load (or total capital on first night) | What the ATM held at start of the day |
| **Dispensed** | opening − cash left | Customer withdrawals |
| **Pending replenish** | open inquiry dispensed | What must be loaded in the morning |
| **Cash in ATM** | `_current_atm_balance()` (open left, or closed + loads) | Latest known machine cash |
| **Trading account** | total capital − cash in ATM | Should reconcile with capital |
| **Total capital** | Set by admin | Franchise capital target |

---

## 4. Screens

| Screen | Operator | Admin | Purpose |
|--------|----------|-------|---------|
| **Home** | ✓ | ✓ | Next action, cash in ATM vs trading account, capital |
| **Cash** | ✓ | ✓ | Night inquiry + morning replenish |
| **Commission** | — | ✓ | Settlements |
| **Users** | — | ✓ | Roles + total capital |
| **Reports** | ✓ | ✓ | Daily track, monthly summary, commission (admin) |

---

## 5. Commission (admin)

Enter settlements as `txns × rate − TDS`. Not inferred from inquiries.

**Reports → Commission** and the **Commission** screen show monthly net / txn totals plus a year bar chart by settlement month.

---

## 6. Receipts, time, location

Every inquiry and replenish is audit-ready: photo, server timestamp, GPS. Operators cannot edit or delete past rows.
