import frappe
from frappe import _
from erpnext.accounts.doctype.payment_request.payment_request import make_payment_request
from frappe.utils import getdate, now_datetime, nowdate, nowtime
from erpnext.accounts.doctype.pos_closing_entry.pos_closing_entry import (
    make_closing_entry_from_opening,
)
import math


CUSTOMER_LIMIT = 50
RECENT_FIRST = "modified desc, name desc"


@frappe.whitelist()
def get_past_order_list(search_term, status, pos_profile, limit=20):
    fields = [
        "name",
        "grand_total",
        "currency",
        "customer",
        "customer_name",
        "posting_time",
        "posting_date",
    ]

    if not status:
        return []

    filters = {"status": status, "pos_profile": pos_profile}
    search_term = (search_term or "").strip()

    if not search_term:
        return frappe.db.get_list(
            "POS Invoice", filters=filters, fields=fields, order_by=RECENT_FIRST, page_length=limit
        )

    invoices_by_customer = []
    customers = matching_customers(search_term)
    if customers:
        invoices_by_customer = frappe.db.get_list(
            "POS Invoice",
            filters={**filters, "customer": ["in", customers]},
            fields=fields,
            order_by=RECENT_FIRST,
            page_length=limit,
        )

    invoices_by_name = frappe.db.get_list(
        "POS Invoice",
        filters=filters,
        or_filters=[["name", "like", pattern] for pattern in invoice_name_patterns(search_term)],
        fields=fields,
        order_by=RECENT_FIRST,
        page_length=limit,
    )

    seen = set()
    return [
        invoice
        for invoice in invoices_by_customer + invoices_by_name
        if not (invoice.name in seen or seen.add(invoice.name))
    ]


def matching_customers(search_term):
    if "victoryfarmsdeveloper" in frappe.get_installed_apps():
        from victoryfarmsdeveloper.setup.till_customer_search import find_candidates

        return find_candidates(search_term)

    return frappe.get_all(
        "Customer",
        or_filters=[
            ["name", "like", f"{search_term}%"],
            ["customer_name", "like", f"{search_term}%"],
            ["mobile_no", "like", f"{search_term}%"],
        ],
        pluck="name",
        limit=CUSTOMER_LIMIT,
    )


def invoice_name_patterns(search_term):
    term = search_term.upper().replace(" ", "")
    if not term.isdigit():
        return [f"{term}%"]

    this_year = getdate(nowdate()).year
    return [
        f"{prefix}{term}%"
        for prefix in invoice_series_prefixes((this_year, this_year - 1))
    ]


def invoice_series_prefixes(years):
    options = frappe.get_meta("POS Invoice").get_field("naming_series").options or ""
    series = [option.strip() for option in options.split("\n") if option.strip()]
    return [
        option.replace(".YYYY.", str(year)).replace(".", "")
        for option in series
        for year in years
    ]


@frappe.whitelist()
def create_payment_request(self):
    for pay in self.payments:
        if pay.type == "Phone":

            if pay.amount <= 0:
                frappe.throw(_("Payment amount cannot be less than or equal to 0"))

            if not self.contact_mobile:
                frappe.throw(_("Please enter the phone number first"))

            pay_req = self.get_existing_payment_request(pay)

            if not pay_req:
                pay_req = self.get_new_payment_request(pay)
                pay_req.submit()
            else:
                pay_req.request_phone_payment()

            return pay_req


def auto_close_open_nrb_pos():
    frappe.log_error("Auto-closing open Nairobi POS sessions")

    # ORIGINAL FILTER
    # pos_profiles = frappe.get_all(
    #     "POS Profile",
    #     filters={
    #         "name": ["!=", "Customer Direct - VLC"],
    #         "custom_region": "Nairobi Region"
    #     },
    #     fields=["name"]
    # )

    # TEST FILTER - ONLY CUSTOMER DIRECT - VLC
    pos_profiles = frappe.get_all(
        "POS Profile",
        filters={
            "name": "Customer Direct - VLC"
        },
        fields=["name"]
    )

    open_entries = frappe.get_all(
        "POS Opening Entry",
        filters={
            "status": "Open",
            "pos_profile": ["in", [p.name for p in pos_profiles]]
        },
        fields=["name", "pos_profile", "user", "company"]
    )

    for entry in open_entries:
        try:
            opening_entry = frappe.get_doc("POS Opening Entry", entry.name)

            closing_entry = make_closing_entry_from_opening(opening_entry)
            closing_entry.period_end_date = now_datetime()
            closing_entry.posting_date = nowdate()
            closing_entry.posting_time = nowtime()

            closing_entry.insert(ignore_permissions=True)
            closing_entry.submit()

            frappe.log_error(
                f"Successfully auto-closed Nairobi POS profile {entry.pos_profile}, opening entry {entry.name}"
            )

        except Exception:
            frappe.log_error(
                frappe.get_traceback(),
                f"Auto Nairobi POS Close Failed: {entry.name}"
            )


def auto_close_open_western_pos():
    frappe.log_error("Auto-closing open Western POS sessions")

    pos_profiles = frappe.get_all(
        "POS Profile",
        filters={
            "name": ["!=", "Customer Direct - VLC"],
            "custom_region": "Western Region"
        },
        fields=["name"]
    )

    open_entries = frappe.get_all(
        "POS Opening Entry",
        filters={
            "status": "Open",
            "pos_profile": ["in", [p.name for p in pos_profiles]]
        },
        fields=["name", "pos_profile", "user", "company"]
    )

    for entry in open_entries:
        try:
            opening_entry = frappe.get_doc("POS Opening Entry", entry.name)

            closing_entry = make_closing_entry_from_opening(opening_entry)
            closing_entry.period_end_date = now_datetime()
            closing_entry.posting_date = nowdate()
            closing_entry.posting_time = nowtime()

            closing_entry.insert(ignore_permissions=True)
            closing_entry.submit()

            frappe.log_error(
                f"Successfully auto-closed Western POS profile {entry.pos_profile}, opening entry {entry.name}"
            )

        except Exception:
            frappe.log_error(
                frappe.get_traceback(),
                f"Auto Western POS Close Failed: {entry.name}"
            )


def auto_close_open_msa_pos():
    frappe.log_error("Auto-closing open Mombasa POS sessions")

    pos_profiles = frappe.get_all(
        "POS Profile",
        filters={
            "name": ["!=", "Customer Direct - VLC"],
            "custom_region": "Mombasa Region"
        },
        fields=["name"]
    )

    open_entries = frappe.get_all(
        "POS Opening Entry",
        filters={
            "status": "Open",
            "pos_profile": ["in", [p.name for p in pos_profiles]]
        },
        fields=["name", "pos_profile", "user", "company"]
    )

    for entry in open_entries:
        try:
            opening_entry = frappe.get_doc("POS Opening Entry", entry.name)

            closing_entry = make_closing_entry_from_opening(opening_entry)
            closing_entry.period_end_date = now_datetime()
            closing_entry.posting_date = nowdate()
            closing_entry.posting_time = nowtime()

            closing_entry.insert(ignore_permissions=True)
            closing_entry.submit()

            frappe.log_error(
                f"Successfully auto-closed Mombasa POS profile {entry.pos_profile}, opening entry {entry.name}"
            )

        except Exception:
            frappe.log_error(
                frappe.get_traceback(),
                f"Auto Mombasa POS Close Failed: {entry.name}"
            )
