# BidMorrow brand kit (checkout, invoices, email)

Source of truth for the mark is `apps/web/src/components/Logo.tsx`; the
wordmark is the word "BidMorrow" in Archivo 700 (self-hosted,
`apps/web/public/fonts`). The PNGs here are rendered from those sources at
2× (script kept in the ledger entry of 2026-08-30) — regenerate rather than
edit by hand if the mark ever changes.

| File                                  | Size      | Use                                                                                                      |
| ------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------- |
| `bidmorrow-logo-horizontal-light.png` | 1050×304  | Paddle checkout logo (light theme — the overlay opens `theme: 'light'`), invoices, email header fallback |
| `bidmorrow-logo-horizontal-dark.png`  | 1050×304  | Dark surfaces (social, decks)                                                                            |
| `bidmorrow-mark-512.png`              | 1024×1024 | Square avatar / app icon / Paddle "brand icon" where a square is required                                |

## Colours

| Token                                           | Hex                 | Where                                                                                     |
| ----------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------- |
| Accent (dark UI)                                | `#2ec4b0`           | app dark theme buttons                                                                    |
| **Accent on white (checkout, invoices, email)** | **`#0f7d6f`**       | Paddle "primary colour" — AA contrast with white text; matches the light-theme `--accent` |
| Accent gradient                                 | `#35d3c0 → #1fa899` | the mark only                                                                             |
| Ink                                             | `#0b1f1c`           | headings on white                                                                         |
| Muted                                           | `#5b6b68`           | secondary text on white                                                                   |
| Border                                          | `#e3e9e8`           | dividers on white                                                                         |
| Deep canvas                                     | `#12151b`           | mark background                                                                           |

## Paddle dashboard steps (same in LIVE and SANDBOX — do both)

1. **Checkout → Checkout settings**
   - Logo: upload `bidmorrow-logo-horizontal-light.png`.
   - Primary / brand colour: `#0f7d6f`.
   - Display discount field on the checkout: **on** (codes `FIRST100`, tests).
   - Default payment link: `https://bidmorrow.com/app/settings` (live) /
     `https://staging.bidmorrow.com/app/settings` (sandbox).
2. **Business → Invoice settings** (name varies by dashboard version:
   "Invoicing" / "Documents"): same logo, company name shown to customers
   `BidMorrow`, support email `support@bidmorrow.com`. Paddle issues the
   invoice as Merchant of Record; these fields brand the PDF customers
   download from Settings → Billing and from the customer portal.
3. **Checkout → Branded inline checkout** is NOT used (we open the overlay);
   leave defaults.

Anything set via API is recorded in the ledger; the logo upload is
dashboard-only.
