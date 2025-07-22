# -*- coding: utf-8 -*-
# Copyright (c) 2020, Youssef Restom and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import json
import frappe

@frappe.whitelist()
def get_data():
    invoices = frappe.get_all("Sales Invoice", filters={"docstatus": 1, "outstanding_amount": [">", 0]},
                              fields=["name", "customer", "outstanding_amount"])
    payments = frappe.get_all("Payment Entry", filters={"docstatus": 1, "references": ["=", []]},
                              fields=["name", "mode_of_payment", "paid_amount as amount"])
    return {"invoices": invoices, "payments": payments}

@frappe.whitelist()
def reconcile(invoices, payments):
    try:
        invoices = frappe.parse_json(invoices)
        payments = frappe.parse_json(payments)
        # Your custom logic to link payments to invoices
        # Possibly create a Journal Entry or update Payment Entry references
        return "success"
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "POS Payment Reconciliation Error")
        frappe.throw(_("Server error: {0}").format(str(e)))

@frappe.whitelist()
def update_invoice_from_order(data):
    data = json.loads(data)
    invoice_doc = frappe.get_doc("Sales Invoice", data.get("name"))
    invoice_doc.update(data)
    invoice_doc.save()
    return invoice_doc

