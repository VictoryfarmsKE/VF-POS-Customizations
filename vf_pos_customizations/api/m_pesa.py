from __future__ import unicode_literals
import json
import requests
from requests.auth import HTTPBasicAuth

import frappe
from frappe import _
from frappe.utils import flt
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
def confirmation(**kwargs) -> Dict[str, Any]:
    """
    Handle M-Pesa payment confirmation callback and enqueues document creation
    """
    try:
        args = frappe._dict(kwargs)
        frappe.set_user("Administrator")

        frappe.enqueue(
            "vf_pos_customizations.api.m_pesa.delayed_insert_mpesa_payment",
            queue="short",
            is_async=True,
            timeout=300,
            payment_data={
                "transactiontype": args.get("TransactionType"),
                "transid": args.get("TransID"),
                "transtime": args.get("TransTime"),
                "transamount": flt(args.get("TransAmount")),
                "businessshortcode": args.get("BusinessShortCode"),
                "billrefnumber": args.get("BillRefNumber"),
                "invoicenumber": args.get("InvoiceNumber"),
                "orgaccountbalance": args.get("OrgAccountBalance"),
                "thirdpartytransid": args.get("ThirdPartyTransID"),
                "msisdn": args.get("MSISDN"),
                "firstname": args.get("FirstName"),
                "middlename": args.get("MiddleName"),
                "lastname": args.get("LastName"),
            },
        )

        frappe.db.commit()
        return {"ResultCode": 0, "ResultDesc": "Accepted"}
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), f"M-Pesa Confirmation Error: {str(e)[:140]}")
        return {"ResultCode": 1, "ResultDesc": "Rejected"}
    finally:
        frappe.set_user("Guest")


def delayed_insert_mpesa_payment(payment_data: Dict[str, Any]) -> None:
    try:
        if payment_data.get("transid") and frappe.db.exists(
            "Mpesa Payment Register", {"transid": payment_data["transid"]}
        ):
            frappe.logger().info(
                f"M-Pesa confirmation skipped — TransID {payment_data['transid']} already recorded."
            )
            return

        doc = frappe.new_doc("Mpesa Payment Register")
        for k, v in payment_data.items():
            setattr(doc, k, v)

        doc.insert(ignore_permissions=True)
        frappe.db.commit()
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Delayed Mpesa Payment Insert Error")
    
    
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