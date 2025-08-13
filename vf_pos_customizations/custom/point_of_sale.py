import frappe
from erpnext.accounts.doctype.payment_request.payment_request import make_payment_request
from frappe.utils import now_datetime, nowdate, nowtime
from erpnext.accounts.doctype.pos_closing_entry.pos_closing_entry import make_closing_entry_from_opening

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

def auto_close_open_pos():
    frappe.log_error("Auto-closing open POS sessions")
    open_entries = frappe.get_all(
        "POS Opening Entry",
        filters={"status": "Open"},
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
            
            frappe.log_error(f"Successfully auto-closed POS for profile {entry.pos_profile}, opening entry {entry.name}")

        except Exception as e:
            frappe.log_error(frappe.get_traceback(), f"Auto POS Close Failed: {entry.name}")