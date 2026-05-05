# VF POS Customizations

## 1. Overview

This app customizes ERPNext Standard POS for Victory Farms' branch operations. Its main purpose is to tighten payment control at checkout, reconcile incoming M-Pesa payments against draft POS invoices, support Pezesha loan-assisted sales, and automate some branch closing tasks.

It solves these business problems:

- Prevents POS invoices from being submitted with excessive change or without a usable M-Pesa reference.
- Gives cashiers/accounts users a separate Payment Reconciliation page to apply draft C2B M-Pesa payments to draft POS invoices.
- Registers and captures M-Pesa C2B callbcks into a dedicated DocType
- Supports Pezesha loan offer lookup, loan application, and loan status checks from the POS payment UI.
- Auto-closes open POS sessions by region on a cron schedule.
- Ships fixture-based client/server scripts for SMS notifications and POS-related custom fields.

Where it fits in the wider stack:

- ERPNext Retail / POS: overrides parts of the Point of Sale frontend and the past order query by filtering by POS Profile.
- Payment Reconciliation: updates POS Invoice payment rows and uses POS Opening/Closing Entry flows.
- Payments / M-Pesa ecosystem: depends on the `Mpesa Settings` DocType from another app in the bench and registers callback URLs against Safaricom on Mpesa Payment Register.
- External integrations: Safaricom M-Pesa C2B + transaction status APIs, Pezesha loan APIs, and an SMS sender in `victoryfarmsdeveloper`.

## 2. Architecture & Design

High-level architecture:

- Frontend POS overrides in `public/js` patch ERPNext POS classes at runtime using prototype overrides.
- Backend APIs in `api/` expose whitelisted methods for payment reconciliation and M-Pesa operations.
- Custom DocTypes in `vf_pos_customizations/vf_pos_customizations/doctype/` store M-Pesa registration/payment data and Pezesha settings.
- Hook-based behavior in `hooks.py` injects JS into POS, overrides a whitelisted ERPNext method, attaches a `before_submit` event to POS Invoice, and defines scheduler jobs.
- Fixtures apply production customizations that are not represented as Python code: Client Script, Server Script, Custom Field, and Property Setter.

Key DocTypes and relationships:

- `Mpesa C2B Register URL`
    - Registers URL for Validation/Confirmation
	- On validate, it calls Safaricom's register URL API and updates `register_status`.
	- Its `business_shortcode` is later used to infer company and mode of payment for incoming M-Pesa transactions.
- `Mpesa Payment Register`
	- Stores raw M-Pesa transaction details such as `transid`, `transamount`, `msisdn`, names, company, customer, and mode of payment.
	- Created from callback traffic or from transaction status results.
	- Submitted later when the payment is linked to a customer.
- `Pezesha Settings`
	- Stores client credentials and a cached bearer token.
	- Used by POS loan-offer, loan-application, and loan-status calls.
- Core ERPNext DocTypes used heavily
	- `POS Invoice`: extended by hook logic, client scripts, and custom fields.
	- `POS Profile`: expected to carry `custom_region` and `custom_pezesha_channel_id`.
	- `POS Opening Entry` / `POS Closing Entry`: used to detect current branch context and auto-close sessions.

Custom scripts, hooks, APIs, and realtime:

- `app_include_js` and `page_js` inject POS-specific custom JavaScript.
- `doc_events["POS Invoice"]["before_submit"]` enforces change threshold and submits the linked M-Pesa register record.
- `override_whitelisted_methods` replaces ERPNext's past-order query with a custom one that also filters by POS Profile.
- `frappe.realtime.publish` is used for M-Pesa transaction status updates, and the list view JS listens for `mpesa_transaction_status_update`.
- Fixture-based Server Scripts send SMS messages after POS invoice events and schedule draft POS invoice cleanup.

Design patterns used:

- Runtime prototype overrides instead of extending core POS classes.
- Dedicated reconciliation page instead of forcing all allocation logic into the standard POS screen.
- Asynchronous M-Pesa confirmation persistence via `frappe.enqueue` to keep callbacks fast and retryable.

## 3. Installation & Setup

Installation steps:

```bash
cd /path/to/frappe-bench
bench get-app /path/to/this/repo/apps/vf_pos_customizations
bench --site <site-name> install-app vf_pos_customizations
bench build
bench --site <site-name> migrate
```

Recommended post-install checks:

- Confirm fixtures were imported: `Client Script`, `Server Script`, `Custom Field`, `Property Setter`.
- Open the POS page and verify the extra buttons `New Invoice` and `Payment Reconciliation` appear.
- Confirm `Mpesa C2B Register URL` can be saved successfully for each active M-Pesa configuration.
- Confirm the site has a working `POS Profile` with the expected custom fields.

Site configuration and secrets:
- M-Pesa credentials are read from `Mpesa Settings`.
- Pezesha credentials are stored in `Pezesha Settings`.

## 4. Configuration

Key settings:

- `Mpesa C2B Register URL`
	- Create one record per M-Pesa settings/profile combination.
	- Set `mpesa_settings`, `company`, and `mode_of_payment`.
	- Saving the document attempts remote URL registration and sets `register_status`.
- `Pezesha Settings`
	- Enable the single record, set `client_id` and `client_secret_id`, and save.
	- Saving fetches and stores an authorization token.
- `POS Profile`
	- `custom_region` drives auto-close scheduling logic.
	- `custom_pezesha_channel_id` is required by the Pezesha API calls.
	- POS payment methods are used by the reconciliation page to build payment rows.

Feature flags and behavioral switches:

- `Pezesha Settings.enable` controls whether the token refresh logic should run.
- The reconciliation page implicitly assumes the active user has an open `POS Opening Entry`.
- SMS behavior lives in fixture Server Scripts, not in `hooks.py`, to disable do it in the site.

External integrations:

- Safaricom M-Pesa
	- C2B confirmation callback: `/api/method/vf_pos_customizations.api.m_pesa.confirmation`
	- C2B validation callback: `/api/method/vf_pos_customizations.api.m_pesa.validation`
	- Transaction status result callback: `/api/method/vf_pos_customizations.api.m_pesa.handle_transaction_status_result`
	- Queue timeout callback: `/api/method/vf_pos_customizations.api.m_pesa.handle_queue_timeout`
- Pezesha
	- OAuth token endpoint: `https://gateway.pezesha.com/oauth/token`
	- Borrower options: `/mfi/v1/borrowers/options`
	- Loan application: `/mfi/v1/borrowers/loans`
	- Latest loan status: `/mfi/v1/borrowers/latest`
- SMS
	- Fixture scripts call `victoryfarmsdeveloper.victoryfarmsdeveloper.customization.sms_settings.sms_settings.send_sms`

## 5. Key Workflows

### M-Pesa C2B intake and reconciliation

1. A `Mpesa C2B Register URL` record is created and validated; this registers the site callback URLs with Safaricom.
2. Safaricom calls the `confirmation` endpoint.
3. The app enqueues `delayed_insert_mpesa_payment` and creates a draft `Mpesa Payment Register` if the `transid` is not already present.
4. `Mpesa Payment Register.before_insert` derives `company` and `mode_of_payment` from `Mpesa C2B Register URL` using `businessshortcode`.
5. An accounts or sales user opens `pos-payments`, selects a customer, selects draft POS invoices, and selects draft M-Pesa payments.
6. `process_pos_payment` updates the invoice payment table, sets accounts from the selected mode of payment, recalculates paid/outstanding/change amounts, saves, and submits the invoice if valid.
7. The same flow calls `submit_mpesa_payment`, which links the M-Pesa register to the customer and submits that document.

### POS invoice submission guardrails

1. A fixture Client Script runs `before_submit` on `POS Invoice` and blocks submission if:
	 - no `mpesa_receipt_number` exists,
	 - multiple comma-separated receipt numbers exist,
	 - `change_amount > 1`.
2. Python `before_submit_invoice` enforces the same change threshold server-side.
3. If a matching `Mpesa Payment Register` is found by `transid == mpesa_receipt_number`, the register is updated with the invoice customer and submitted.

### Pezesha loan-assisted sale

1. POS payment UI calls `pezesha_loan_offer` using the current customer and active POS Profile.
2. The frontend shows loan options and computes interest/fee summaries client-side.
3. The selected offer is submitted to `pezesha_loan_application`.
4. `pezesha_loan_status` can query the latest borrower state.
5. The POS Profile must contain `custom_pezesha_channel_id` for these calls to work.

### POS session auto-close by region

1. Scheduler calls regional auto-close functions at `0 23 * * *`.
2. Each function fetches `POS Profile` rows by `custom_region`.
3. Open `POS Opening Entry` records for those profiles are converted into `POS Closing Entry` records using ERPNext's `make_closing_entry_from_opening`.
4. Errors are logged with `frappe.log_error` and processing continues for other entries.

### M-Pesa transaction status query from list view

1. User opens the `Mpesa Payment Register` list and clicks `Check Transaction Status`.
2. List JS prompts for `Mpesa Settings` and a transaction ID.
3. `trigger_transaction_status` creates an `Integration Request`, sends the Safaricom query, and stores the immediate API response.
4. Safaricom later calls the result callback.
5. The app creates a `Mpesa Payment Register` if the receipt is not already recorded and publishes a realtime status update.

## 6. Code Structure

Folder breakdown:

- `vf_pos_customizations/hooks.py`
	- Main app wiring: fixtures, JS includes, POS method override, doc events, scheduler events.
- `vf_pos_customizations/api/`
	- `m_pesa.py`: callback endpoints, token generation, draft payment lookup, submit flow, transaction status query handling.
	- `payment_entry.py`: reconciliation APIs for outstanding invoices, unallocated payments, and payment application.
- `vf_pos_customizations/custom/point_of_sale.py`
	- Custom past-order search and regional POS auto-close jobs.
- `vf_pos_customizations/public/js/`
	- POS frontend runtime overrides.
- `vf_pos_customizations/vf_pos_customizations/doctype/`
	- Custom DocTypes and their controllers.
- `vf_pos_customizations/vf_pos_customizations/page/pos_payments/`
	- Custom desk page for payment reconciliation.
- `vf_pos_customizations/vf_pos_customizations/report/pos_invoice_daily_sales/`
	- Script report for POS sales grouped by warehouse/item/date selection.
- `vf_pos_customizations/fixtures/`
	- Site-level Client Script, Server Script, Custom Field, and Property Setter definitions.

## 7. Customizations & Overrides

Core behavior overrides:

- Overrides ERPNext's `get_past_order_list` to add POS Profile filtering.
- Patches ERPNext POS frontend classes at runtime:
	- `Controller.make_app`
	- `Controller.new_invoice`
	- `PastOrderList.prepare_dom`
	- `PastOrderList.make_filter_section`
	- `PastOrderList.refresh_list`
	- `Payment` methods for Pezesha flow
- Injects a new POS route entry to `pos-payments`.

Custom fields and property setters shipped as fixtures:

- `POS Invoice.sms_sent`
- `POS Invoice.custom_pos_territory`
- `POS Invoice.test_send_sms`
- `POS Invoice.pos_opening_shift`
- `POS Profile.custom_region`
- Property setter marking `POS Invoice.pos_opening_shift` as `no_copy`
