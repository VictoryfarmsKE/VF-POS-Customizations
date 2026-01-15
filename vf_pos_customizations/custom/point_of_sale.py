import frappe
from erpnext.accounts.doctype.payment_request.payment_request import make_payment_request
from frappe.utils import now_datetime, nowdate, nowtime
from erpnext.accounts.doctype.pos_closing_entry.pos_closing_entry import make_closing_entry_from_opening
import math

@frappe.whitelist()
def get_past_order_list(search_term, status, pos_profile, limit=20):
	fields = ["name", "grand_total", "currency", "customer", "customer_name", "posting_time", "posting_date"]
	invoice_list = []

	if search_term and status:
		invoices_by_customer = frappe.db.get_list(
			"POS Invoice",
             #filter by pos_profile
             
			filters={"status": status, "pos_profile": pos_profile},
   

			or_filters={
				"customer_name": ["like", f"%{search_term}%"],
				"customer": ["like", f"%{search_term}%"],
			},
			fields=fields,
			page_length=limit,
		)
		invoices_by_name = frappe.db.get_list(
			"POS Invoice",
			filters={"name": ["like", f"%{search_term}%"], "status": status,"pos_profile": pos_profile},
			fields=fields,
			page_length=limit,
		)

		invoice_list = invoices_by_customer + invoices_by_name
	elif status:
		invoice_list = frappe.db.get_list(
			"POS Invoice", filters={"status": status,"pos_profile": pos_profile}, fields=fields, page_length=limit
		)

	return invoice_list

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
    # frappe.log_error("Auto-closing open Nairobi POS sessions")
    #find POS Profiles where the POS Profile field custom_region = "Nairobi Region"
    pos_profiles = frappe.get_all(
        "POS Profile",
        filters={"name": ["!=", "Customer Direct - VLC"], "custom_region": "Nairobi Region"},
        fields=["name"]
    )
    #then filter by the above pos profiles
    open_entries = frappe.get_all(
        "POS Opening Entry",
        filters={"status": "Open", "pos_profile": ["in", [p.name for p in pos_profiles]]},
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
            
            # frappe.log_error(f"Successfully auto-closed Nairobi POS profile {entry.pos_profile}, opening entry {entry.name}")

        except Exception as e:
            frappe.log_error(frappe.get_traceback(), f"Auto Nairobi POS Close Failed: {entry.name}")
 
def auto_close_open_western_pos():
    # frappe.log_error("Auto-closing open Western POS sessions")
    #find POS Profiles where the POS Profile field custom_region = "Western Region"
    pos_profiles = frappe.get_all(
        "POS Profile",
        filters={"name": ["!=", "Customer Direct - VLC"], "custom_region": "Western Region"},
        fields=["name"]
    )
    #then filter by the above pos profiles
    open_entries = frappe.get_all(
        "POS Opening Entry",
        filters={"status": "Open", "pos_profile": ["in", [p.name for p in pos_profiles]]},
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
            
            # frappe.log_error(f"Successfully auto-closed Western POS profile {entry.pos_profile}, opening entry {entry.name}")

        except Exception as e:
            frappe.log_error(frappe.get_traceback(), f"Auto Western POS Close Failed: {entry.name}")
            
def auto_close_open_msa_pos():
    # frappe.log_error("Auto-closing open Mombasa POS sessions")
    #find POS Profiles where the POS Profile field custom_region = "Mombasa Region"
    pos_profiles = frappe.get_all(
        "POS Profile",
        filters={"name": ["!=", "Customer Direct - VLC"], "custom_region": "Mombasa Region"},
        fields=["name"]
    )
    #then filter by the above pos profiles
    open_entries = frappe.get_all(
        "POS Opening Entry",
        filters={"status": "Open", "pos_profile": ["in", [p.name for p in pos_profiles]]},
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
            # frappe.log_error(f"Successfully auto-closed Mombasa POS profile {entry.pos_profile}, opening entry {entry.name}")

        except Exception as e:
            frappe.log_error(frappe.get_traceback(), f"Auto Mombasa POS Close Failed: {entry.name}")