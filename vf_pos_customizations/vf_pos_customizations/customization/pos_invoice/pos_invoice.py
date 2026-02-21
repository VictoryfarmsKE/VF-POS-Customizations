import frappe
from frappe import _

def before_submit_invoice(self, event):
        change_amount = self.change_amount or 0
        if change_amount > 1:
            frappe.throw(
                _("Cannot submit invoice {0}: change amount {1} exceeds the allowed threshold of 1. "
                  "Please correct the payment amount before submitting.").format(
                    self.name, frappe.bold(f"{change_amount:.2f}")
                ),
                title=_("Overpayment Detected")
            )

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