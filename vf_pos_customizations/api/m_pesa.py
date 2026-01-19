from __future__ import unicode_literals
import json
import requests
from requests.auth import HTTPBasicAuth

import frappe
from frappe import _
from typing import Optional, List, Dict, Any

def get_token(app_key: str, app_secret: str, base_url: str) -> str:
    """
    Retrieve OAuth token from M-Pesa API.
    """
    authenticate_uri = "/oauth/v1/generate?grant_type=client_credentials"
    authenticate_url = f"{base_url}{authenticate_uri}"
    response = requests.get(authenticate_url, auth=HTTPBasicAuth(app_key, app_secret))
    response.raise_for_status()
    return response.json().get("access_token", "")

@frappe.whitelist(allow_guest=True)
def confirmation(**kwargs):
    try:
        args = frappe._dict(kwargs)

        # detect B2B payloads (presence of Initiator or Command ID/CommandID)
        is_b2b = bool(args.get("Initiator") or args.get("Command ID") or args.get("CommandID"))

        doc = frappe.new_doc("Mpesa Payment Register")

        # store raw payload for auditing (backward compatible)
        try:
            doc.raw_payload = json.dumps(kwargs)
        except Exception:
            doc.raw_payload = str(kwargs)

        # common mappings (C2B and B2B)
        # Amount / TransAmount -> transamount
        doc.transamount = args.get("TransAmount") or args.get("Amount")

        # Transaction / Command
        doc.transactiontype = args.get("TransactionType") or args.get("Command ID") or args.get("CommandID")

        # Shortcodes / parties
        doc.businessshortcode = args.get("BusinessShortCode") or args.get("PartyA")
        # PartyB doesn't map directly to existing field; save into billrefnumber if present
        if args.get("PartyB"):
            doc.billrefnumber = args.get("PartyB")
        else:
            doc.billrefnumber = args.get("BillRefNumber") or args.get("AccountReference")

        # IDs and references
        doc.transid = args.get("TransID") or args.get("AccountReference") or args.get("ThirdPartyTransID")
        doc.invoicenumber = args.get("InvoiceNumber")
        doc.orgaccountbalance = args.get("OrgAccountBalance")
        doc.thirdpartytransid = args.get("ThirdPartyTransID") or args.get("SecurityCredential")

        # requester / msisdn mapping
        doc.msisdn = args.get("MSISDN") or args.get("Requester")

        # names (if present)
        doc.firstname = args.get("FirstName")
        doc.middlename = args.get("MiddleName")
        doc.lastname = args.get("LastName")

        doc.insert(ignore_permissions=True)
        frappe.db.commit()

        # Return string result codes per M-PESA spec
        context = {"ResultCode": "0", "ResultDesc": "Accepted"}
        return dict(context)
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), str(e)[:140])
        context = {"ResultCode": "1", "ResultDesc": "Rejected"}
        return dict(context)


@frappe.whitelist(allow_guest=True)
def validation(**kwargs) -> Dict[str, Any]:
    """
    Handle M-Pesa payment validation callback for both C2B and B2B (always accepts for now).
    """
    return {"ResultCode": 0, "ResultDesc": "Accepted"}


@frappe.whitelist()
def get_mpesa_mode_of_payment(company: str) -> List[str]:
    """
    Get unique M-Pesa modes of payment for a company with successful registration.
    """
    modes = frappe.get_all(
        "Mpesa C2B Register URL",
        filters={"company": company, "register_status": "Success"},
        fields=["mode_of_payment"],
    )
    return list({mode.mode_of_payment for mode in modes if mode.mode_of_payment})

@frappe.whitelist()
def get_mpesa_draft_payments(
    company,
    mode_of_payment=None,
    mobile_no=None,
    full_name=None,
    payment_methods_list=None,
):
    filters = {"company": company, "docstatus": 0}
    if mode_of_payment:
        filters["mode_of_payment"] = mode_of_payment
    if mobile_no:
        filters["msisdn"] = ["like", f"%{mobile_no}%"]
    if full_name:
        filters["full_name"] = ["like", f"%{full_name}%"]
    if payment_methods_list:
        filters["mode_of_payment"] = ["in", json.loads(payment_methods_list)]

    payments = frappe.get_all(
        "Mpesa Payment Register",
        filters=filters,
        fields=[
            "name",
            "transid",
            "msisdn as mobile_no",
            "full_name",
            "posting_date",
            "transamount as amount",
            "currency",
            "mode_of_payment",
            "company",
        ],
        order_by="posting_date desc",
    )
    return payments


@frappe.whitelist()
def submit_mpesa_payment(mpesa_payment: str, customer: str) -> Dict[str, Any]:
    """
    Link a customer to an M-Pesa payment and submit it, returning the related Payment Entry document.
    Works for both C2B and B2B payments.
    """
    doc = frappe.get_doc("Mpesa Payment Register", mpesa_payment)
    doc.customer = customer
    doc.submit_payment = 1
    doc.submit()
    # return frappe.get_doc("Payment Entry", doc.payment_entry).as_dict()
    return frappe.msgprint(_("Thank you for your payment."))