import frappe

def before_submit_invoice(self, event):
        # Find Mpesa Payment Register with matching transid
        payment_register = frappe.get_all(
            "Mpesa Payment Register",
            filters={"transid": self.mpesa_receipt_number},
            fields=["name"]
        )
        if payment_register:
            pr_doc = frappe.get_doc("Mpesa Payment Register", payment_register[0].name)
            pr_doc.customer = self.customer
            pr_doc.submit()