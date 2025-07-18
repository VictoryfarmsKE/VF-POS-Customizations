# -*- coding: utf-8 -*-
# Copyright (c) 2020, Youssef Restom and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import json
import frappe
from frappe.utils import nowdate, flt, cstr, getdate
from frappe import _
from erpnext.accounts.doctype.sales_invoice.sales_invoice import get_bank_cash_account
from erpnext.stock.get_item_details import get_item_details
from erpnext.accounts.doctype.pos_profile.pos_profile import get_item_groups
from frappe.utils.background_jobs import enqueue
from erpnext.accounts.party import get_party_bank_account
from erpnext.stock.doctype.batch.batch import (
    get_batch_no,
    get_batch_qty,
    set_batch_nos,
)
from erpnext.accounts.doctype.payment_request.payment_request import (
    get_dummy_message,
    get_existing_payment_request_amount,
)

from erpnext.selling.doctype.sales_order.sales_order import make_sales_invoice
from erpnext.accounts.doctype.loyalty_program.loyalty_program import (
    get_loyalty_program_details_with_points,
)

from frappe.utils.caching import redis_cache

@frappe.whitelist()
def update_invoice_from_order(data):
    data = json.loads(data)
    invoice_doc = frappe.get_doc("Sales Invoice", data.get("name"))
    invoice_doc.update(data)
    invoice_doc.save()
    return invoice_doc


@frappe.whitelist()
def update_invoice(data):
    data = json.loads(data)
    if data.get("name"):
        invoice_doc = frappe.get_doc("Sales Invoice", data.get("name"))
        invoice_doc.update(data)
    else:
        invoice_doc = frappe.get_doc(data)

    invoice_doc.set_missing_values()
    invoice_doc.flags.ignore_permissions = True
    frappe.flags.ignore_account_permission = True

    if invoice_doc.is_return and invoice_doc.return_against:
        ref_doc = frappe.get_cached_doc(invoice_doc.doctype, invoice_doc.return_against)
        if not ref_doc.update_stock:
            invoice_doc.update_stock = 0
        if len(invoice_doc.payments) == 0:
            invoice_doc.payments = ref_doc.payments
        invoice_doc.paid_amount = (
            invoice_doc.rounded_total or invoice_doc.grand_total or invoice_doc.total
        )
        for payment in invoice_doc.payments:
            if payment.default:
                payment.amount = invoice_doc.paid_amount
    allow_zero_rated_items = frappe.get_cached_value(
        "POS Profile", invoice_doc.pos_profile, "posa_allow_zero_rated_items"
    )
    for item in invoice_doc.items:
        if not item.rate or item.rate == 0:
            if allow_zero_rated_items:
                item.price_list_rate = 0.00
                item.is_free_item = 1
            else:
                frappe.throw(
                    _("Rate cannot be zero for item {0}").format(item.item_code)
                )
        else:
            item.is_free_item = 0
        add_taxes_from_tax_template(item, invoice_doc)

    if frappe.get_cached_value(
        "POS Profile", invoice_doc.pos_profile, "posa_tax_inclusive"
    ):
        if invoice_doc.get("taxes"):
            for tax in invoice_doc.taxes:
                tax.included_in_print_rate = 1

    today_date = getdate()
    if (
        invoice_doc.get("posting_date")
        and getdate(invoice_doc.posting_date) != today_date
    ):
        invoice_doc.set_posting_time = 1

    invoice_doc.save()
    return invoice_doc


@frappe.whitelist()
def submit_invoice(invoice, data):
    data = json.loads(data)
    invoice = json.loads(invoice)
    invoice_doc = frappe.get_doc("Sales Invoice", invoice.get("name"))
    invoice_doc.update(invoice)
    if invoice.get("posa_delivery_date"):
        invoice_doc.update_stock = 0
    mop_cash_list = [
        i.mode_of_payment
        for i in invoice_doc.payments
        if "cash" in i.mode_of_payment.lower() and i.type == "Cash"
    ]
    if len(mop_cash_list) > 0:
        cash_account = get_bank_cash_account(mop_cash_list[0], invoice_doc.company)
    else:
        cash_account = {
            "account": frappe.get_value(
                "Company", invoice_doc.company, "default_cash_account"
            )
        }

    # creating advance payment
    if data.get("credit_change"):
        advance_payment_entry = frappe.get_doc(
            {
                "doctype": "Payment Entry",
                "mode_of_payment": "Cash",
                "paid_to": cash_account["account"],
                "payment_type": "Receive",
                "party_type": "Customer",
                "party": invoice_doc.get("customer"),
                "paid_amount": invoice_doc.get("credit_change"),
                "received_amount": invoice_doc.get("credit_change"),
                "company": invoice_doc.get("company"),
            }
        )

        advance_payment_entry.flags.ignore_permissions = True
        frappe.flags.ignore_account_permission = True
        advance_payment_entry.save()
        advance_payment_entry.submit()

    # calculating cash
    total_cash = 0
    if data.get("redeemed_customer_credit"):
        total_cash = invoice_doc.total - float(data.get("redeemed_customer_credit"))

    is_payment_entry = 0
    if data.get("redeemed_customer_credit"):
        for row in data.get("customer_credit_dict"):
            if row["type"] == "Advance" and row["credit_to_redeem"]:
                advance = frappe.get_doc("Payment Entry", row["credit_origin"])

                advance_payment = {
                    "reference_type": "Payment Entry",
                    "reference_name": advance.name,
                    "remarks": advance.remarks,
                    "advance_amount": advance.unallocated_amount,
                    "allocated_amount": row["credit_to_redeem"],
                }

                invoice_doc.append("advances", advance_payment)
                invoice_doc.is_pos = 0
                is_payment_entry = 1

    payments = invoice_doc.payments

    if frappe.get_value("POS Profile", invoice_doc.pos_profile, "posa_auto_set_batch"):
        set_batch_nos(invoice_doc, "warehouse", throw=True)
    set_batch_nos_for_bundels(invoice_doc, "warehouse", throw=True)

    invoice_doc.flags.ignore_permissions = True
    frappe.flags.ignore_account_permission = True
    invoice_doc.posa_is_printed = 1
    invoice_doc.save()

    if data.get("due_date"):
        frappe.db.set_value(
            "Sales Invoice",
            invoice_doc.name,
            "due_date",
            data.get("due_date"),
            update_modified=False,
        )

    if frappe.get_value(
        "POS Profile",
        invoice_doc.pos_profile,
        "posa_allow_submissions_in_background_job",
    ):
        invoices_list = frappe.get_all(
            "Sales Invoice",
            filters={
                "posa_pos_opening_shift": invoice_doc.posa_pos_opening_shift,
                "docstatus": 0,
                "posa_is_printed": 1,
            },
        )
        for invoice in invoices_list:
            enqueue(
                method=submit_in_background_job,
                queue="short",
                timeout=1000,
                is_async=True,
                kwargs={
                    "invoice": invoice.name,
                    "data": data,
                    "is_payment_entry": is_payment_entry,
                    "total_cash": total_cash,
                    "cash_account": cash_account,
                    "payments": payments,
                },
            )
    else:
        invoice_doc.submit()
        redeeming_customer_credit(
            invoice_doc, data, is_payment_entry, total_cash, cash_account, payments
        )

    return {"name": invoice_doc.name, "status": invoice_doc.docstatus}


def redeeming_customer_credit(
    invoice_doc, data, is_payment_entry, total_cash, cash_account, payments
):
    # redeeming customer credit with journal voucher
    today = nowdate()
    if data.get("redeemed_customer_credit"):
        cost_center = frappe.get_value(
            "POS Profile", invoice_doc.pos_profile, "cost_center"
        )
        if not cost_center:
            cost_center = frappe.get_value(
                "Company", invoice_doc.company, "cost_center"
            )
        if not cost_center:
            frappe.throw(
                _("Cost Center is not set in pos profile {}").format(
                    invoice_doc.pos_profile
                )
            )
        for row in data.get("customer_credit_dict"):
            if row["type"] == "Invoice" and row["credit_to_redeem"]:
                outstanding_invoice = frappe.get_doc(
                    "Sales Invoice", row["credit_origin"]
                )

                jv_doc = frappe.get_doc(
                    {
                        "doctype": "Journal Entry",
                        "voucher_type": "Journal Entry",
                        "posting_date": today,
                        "company": invoice_doc.company,
                    }
                )

                jv_debit_entry = {
                    "account": outstanding_invoice.debit_to,
                    "party_type": "Customer",
                    "party": invoice_doc.customer,
                    "reference_type": "Sales Invoice",
                    "reference_name": outstanding_invoice.name,
                    "debit_in_account_currency": row["credit_to_redeem"],
                    "cost_center": cost_center,
                }

                jv_credit_entry = {
                    "account": invoice_doc.debit_to,
                    "party_type": "Customer",
                    "party": invoice_doc.customer,
                    "reference_type": "Sales Invoice",
                    "reference_name": invoice_doc.name,
                    "credit_in_account_currency": row["credit_to_redeem"],
                    "cost_center": cost_center,
                }

                jv_doc.append("accounts", jv_debit_entry)
                jv_doc.append("accounts", jv_credit_entry)

                jv_doc.flags.ignore_permissions = True
                frappe.flags.ignore_account_permission = True
                jv_doc.set_missing_values()
                jv_doc.save()
                jv_doc.submit()

    if is_payment_entry and total_cash > 0:
        for payment in payments:
            if not payment.amount:
                continue
            payment_entry_doc = frappe.get_doc(
                {
                    "doctype": "Payment Entry",
                    "posting_date": today,
                    "payment_type": "Receive",
                    "party_type": "Customer",
                    "party": invoice_doc.customer,
                    "paid_amount": payment.amount,
                    "received_amount": payment.amount,
                    "paid_from": invoice_doc.debit_to,
                    "paid_to": payment.account,
                    "company": invoice_doc.company,
                    "mode_of_payment": payment.mode_of_payment,
                    "reference_no": invoice_doc.posa_pos_opening_shift,
                    "reference_date": today,
                }
            )

            payment_reference = {
                "allocated_amount": payment.amount,
                "due_date": data.get("due_date"),
                "reference_doctype": "Sales Invoice",
                "reference_name": invoice_doc.name,
            }

            payment_entry_doc.append("references", payment_reference)
            payment_entry_doc.flags.ignore_permissions = True
            frappe.flags.ignore_account_permission = True
            payment_entry_doc.save()
            payment_entry_doc.submit()


def submit_in_background_job(kwargs):
    invoice = kwargs.get("invoice")
    invoice_doc = kwargs.get("invoice_doc")
    data = kwargs.get("data")
    is_payment_entry = kwargs.get("is_payment_entry")
    total_cash = kwargs.get("total_cash")
    cash_account = kwargs.get("cash_account")
    payments = kwargs.get("payments")

    invoice_doc = frappe.get_doc("Sales Invoice", invoice)
    invoice_doc.submit()
    redeeming_customer_credit(
        invoice_doc, data, is_payment_entry, total_cash, cash_account, payments
    )


@frappe.whitelist()
def get_available_credit(customer, company):
    total_credit = []

    outstanding_invoices = frappe.get_all(
        "Sales Invoice",
        {
            "outstanding_amount": ["<", 0],
            "docstatus": 1,
            "is_return": 0,
            "customer": customer,
            "company": company,
        },
        ["name", "outstanding_amount"],
    )

    for row in outstanding_invoices:
        outstanding_amount = -(row.outstanding_amount)
        row = {
            "type": "Invoice",
            "credit_origin": row.name,
            "total_credit": outstanding_amount,
            "credit_to_redeem": 0,
        }

        total_credit.append(row)

    advances = frappe.get_all(
        "Payment Entry",
        {
            "unallocated_amount": [">", 0],
            "party_type": "Customer",
            "party": customer,
            "company": company,
            "docstatus": 1,
        },
        ["name", "unallocated_amount"],
    )

    for row in advances:
        row = {
            "type": "Advance",
            "credit_origin": row.name,
            "total_credit": row.unallocated_amount,
            "credit_to_redeem": 0,
        }

        total_credit.append(row)

    return total_credit


@frappe.whitelist()
def create_payment_request(doc):
    doc = json.loads(doc)
    for pay in doc.get("payments"):
        if pay.get("type") == "Phone":
            if pay.get("amount") <= 0:
                frappe.throw(_("Payment amount cannot be less than or equal to 0"))

            if not doc.get("contact_mobile"):
                frappe.throw(_("Please enter the phone number first"))

            pay_req = get_existing_payment_request(doc, pay)
            if not pay_req:
                pay_req = get_new_payment_request(doc, pay)
                pay_req.submit()
            else:
                pay_req.request_phone_payment()

            return pay_req


def get_new_payment_request(doc, mop):
    payment_gateway_account = frappe.db.get_value(
        "Payment Gateway Account",
        {
            "payment_account": mop.get("account"),
        },
        ["name"],
    )

    args = {
        "dt": "Sales Invoice",
        "dn": doc.get("name"),
        "recipient_id": doc.get("contact_mobile"),
        "mode_of_payment": mop.get("mode_of_payment"),
        "payment_gateway_account": payment_gateway_account,
        "payment_request_type": "Inward",
        "party_type": "Customer",
        "party": doc.get("customer"),
        "return_doc": True,
    }
    return make_payment_request(**args)


def get_payment_gateway_account(args):
    return frappe.db.get_value(
        "Payment Gateway Account",
        args,
        ["name", "payment_gateway", "payment_account", "message"],
        as_dict=1,
    )


def get_existing_payment_request(doc, pay):
    payment_gateway_account = frappe.db.get_value(
        "Payment Gateway Account",
        {
            "payment_account": pay.get("account"),
        },
        ["name"],
    )

    args = {
        "doctype": "Payment Request",
        "reference_doctype": "Sales Invoice",
        "reference_name": doc.get("name"),
        "payment_gateway_account": payment_gateway_account,
        "email_to": doc.get("contact_mobile"),
    }
    pr = frappe.db.exists(args)
    if pr:
        return frappe.get_doc("Payment Request", pr)


def make_payment_request(**args):
    """Make payment request"""

    args = frappe._dict(args)

    ref_doc = frappe.get_doc(args.dt, args.dn)
    gateway_account = get_payment_gateway_account(args.get("payment_gateway_account"))
    if not gateway_account:
        frappe.throw(_("Payment Gateway Account not found"))

    grand_total = get_amount(ref_doc, gateway_account.get("payment_account"))
    if args.loyalty_points and args.dt == "Sales Order":
        from erpnext.accounts.doctype.loyalty_program.loyalty_program import (
            validate_loyalty_points,
        )

        loyalty_amount = validate_loyalty_points(ref_doc, int(args.loyalty_points))
        frappe.db.set_value(
            "Sales Order",
            args.dn,
            "loyalty_points",
            int(args.loyalty_points),
            update_modified=False,
        )
        frappe.db.set_value(
            "Sales Order",
            args.dn,
            "loyalty_amount",
            loyalty_amount,
            update_modified=False,
        )
        grand_total = grand_total - loyalty_amount

    bank_account = (
        get_party_bank_account(args.get("party_type"), args.get("party"))
        if args.get("party_type")
        else ""
    )

    existing_payment_request = None
    if args.order_type == "Shopping Cart":
        existing_payment_request = frappe.db.get_value(
            "Payment Request",
            {
                "reference_doctype": args.dt,
                "reference_name": args.dn,
                "docstatus": ("!=", 2),
            },
        )

    if existing_payment_request:
        frappe.db.set_value(
            "Payment Request",
            existing_payment_request,
            "grand_total",
            grand_total,
            update_modified=False,
        )
        pr = frappe.get_doc("Payment Request", existing_payment_request)
    else:
        if args.order_type != "Shopping Cart":
            existing_payment_request_amount = get_existing_payment_request_amount(
                args.dt, args.dn
            )

            if existing_payment_request_amount:
                grand_total -= existing_payment_request_amount

        pr = frappe.new_doc("Payment Request")
        pr.update(
            {
                "payment_gateway_account": gateway_account.get("name"),
                "payment_gateway": gateway_account.get("payment_gateway"),
                "payment_account": gateway_account.get("payment_account"),
                "payment_channel": gateway_account.get("payment_channel"),
                "payment_request_type": args.get("payment_request_type"),
                "currency": ref_doc.currency,
                "grand_total": grand_total,
                "mode_of_payment": args.mode_of_payment,
                "email_to": args.recipient_id or ref_doc.owner,
                "subject": _("Payment Request for {0}").format(args.dn),
                "message": gateway_account.get("message") or get_dummy_message(ref_doc),
                "reference_doctype": args.dt,
                "reference_name": args.dn,
                "party_type": args.get("party_type") or "Customer",
                "party": args.get("party") or ref_doc.get("customer"),
                "bank_account": bank_account,
            }
        )

        if args.order_type == "Shopping Cart" or args.mute_email:
            pr.flags.mute_email = True

        pr.insert(ignore_permissions=True)
        if args.submit_doc:
            pr.submit()

    if args.order_type == "Shopping Cart":
        frappe.db.commit()
        frappe.local.response["type"] = "redirect"
        frappe.local.response["location"] = pr.get_payment_url()

    if args.return_doc:
        return pr

    return pr.as_dict()


def get_amount(ref_doc, payment_account=None):
    """get amount based on doctype"""
    grand_total = 0
    for pay in ref_doc.payments:
        if pay.type == "Phone" and pay.account == payment_account:
            grand_total = pay.amount
            break

    if grand_total > 0:
        return grand_total

    else:
        frappe.throw(
            _("Payment Entry is already created or payment account is not matched")
        )


@frappe.whitelist()
def create_sales_invoice_from_order(sales_order):
    sales_invoice = make_sales_invoice(sales_order, ignore_permissions=True)
    sales_invoice.save()
    return sales_invoice

@frappe.whitelist()
def get_sales_invoice_child_table(sales_invoice, sales_invoice_item):
    parent_doc = frappe.get_doc("Sales Invoice", sales_invoice)
    child_doc = frappe.get_doc(
        "Sales Invoice Item", {"parent": parent_doc.name, "name": sales_invoice_item}
    )
    return child_doc
