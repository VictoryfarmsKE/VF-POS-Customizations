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


@frappe.whitelist()
def register_c2b_urls(
    shortcode: str,
    app_key: str,
    app_secret: str,
    base_url: str,
    validation_url: str,
    confirmation_url: str,
    response_type: str = "Completed"
):
    """
    Register or overwrite C2B URLs with Safaricom.
    Logs both request and response together in a single Error Log.
    """
    try:
        # get OAuth token
        token = get_token(app_key, app_secret, base_url)

        # endpoint
        register_url = f"{base_url}/mpesa/c2b/v1/registerurl"

        # request payload
        payload = {
            "ShortCode": shortcode,
            "ResponseType": response_type,
            "ConfirmationURL": confirmation_url,
            "ValidationURL": validation_url,
        }

        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }

        # send request
        r = requests.post(register_url, json=payload, headers=headers, timeout=30)
        r.raise_for_status()

        # build combined log
        log_message = f"""
            M-PESA C2B Registration Attempt

            ▶️ Request:
            {json.dumps(payload, indent=2)}

            ▶️ Response:
            {r.text}
            """

        frappe.log_error(log_message, "M-PESA C2B Registration")

        return r.json()

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), f"M-Pesa C2B URL Registration Error: {str(e)[:140]}")
        return {"error": str(e)}


@frappe.whitelist(allow_guest=True)
def confirmation(**kwargs) -> Dict[str, Any]:
    """
    Handle M-Pesa payment confirmation callback and create Mpesa Payment Register document.
    """
    try:
        args = frappe._dict(kwargs)
        doc = frappe.new_doc("Mpesa Payment Register")
        doc.transactiontype = args.get("TransactionType")
        doc.transid = args.get("TransID")
        doc.transtime = args.get("TransTime")
        doc.transamount = args.get("TransAmount")
        doc.businessshortcode = args.get("BusinessShortCode")
        doc.billrefnumber = args.get("BillRefNumber")
        doc.invoicenumber = args.get("InvoiceNumber")
        doc.orgaccountbalance = args.get("OrgAccountBalance")
        doc.thirdpartytransid = args.get("ThirdPartyTransID")
        doc.msisdn = args.get("MSISDN")
        doc.firstname = args.get("FirstName")
        doc.middlename = args.get("MiddleName")
        doc.lastname = args.get("LastName")
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        return {"ResultCode": 0, "ResultDesc": "Accepted"}
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), f"M-Pesa Confirmation Error: {str(e)[:140]}")
        return {"ResultCode": 1, "ResultDesc": "Rejected"}


@frappe.whitelist(allow_guest=True)
def validation(**kwargs) -> Dict[str, Any]:
    """
    Handle M-Pesa payment validation callback (always accepts for now).
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
    # Use set comprehension for uniqueness
    return list({mode.mode_of_payment for mode in modes if mode.mode_of_payment})


@frappe.whitelist()
def get_mpesa_draft_payments(
    company: str,
    mode_of_payment: Optional[str] = None,
    mobile_no: Optional[str] = None,
    full_name: Optional[str] = None,
    payment_methods_list: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Get draft (unsubmitted) M-Pesa payments for a company, with optional filters.
    """
    filters = {"company": company, "docstatus": 0}
    if mode_of_payment:
        filters["mode_of_payment"] = mode_of_payment
    if mobile_no:
        filters["msisdn"] = ["like", f"%{mobile_no}%"]
    if full_name:
        filters["full_name"] = ["like", f"%{full_name}%"]
    if payment_methods_list:
        try:
            methods = json.loads(payment_methods_list)
            if isinstance(methods, list):
                filters["mode_of_payment"] = ["in", methods]
        except Exception:
            pass

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
    """
    doc = frappe.get_doc("Mpesa Payment Register", mpesa_payment)
    doc.customer = customer
    doc.submit_payment = 1
    doc.submit()
    # return frappe.get_doc("Payment Entry", doc.payment_entry).as_dict()
    return frappe.msgprint(_("Thank you for your payment."))
 