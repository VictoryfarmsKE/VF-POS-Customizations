import frappe

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

