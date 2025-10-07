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


# @frappe.whitelist(allow_guest=True)
# def confirmation(**kwargs) -> Dict[str, Any]:
#     """
#     Handle M-Pesa payment confirmation callback for both C2B and B2B payments.
#     Automatically detects payment type and creates appropriate Mpesa Payment Register document.
#     """
#     try:
#         args = frappe._dict(kwargs)
#         doc = frappe.new_doc("Mpesa Payment Register")
        
#         # Detect payment type based on available fields
#         # B2B payments typically have different field patterns or specific transaction types
#         transaction_type = args.get("TransactionType", "")
        
#         # Common fields for both C2B and B2B
#         doc.transactiontype = transaction_type
#         doc.transid = args.get("TransID")
#         doc.transtime = args.get("TransTime")
#         doc.transamount = args.get("TransAmount")
#         doc.businessshortcode = args.get("BusinessShortCode")
#         doc.billrefnumber = args.get("BillRefNumber")
#         doc.invoicenumber = args.get("InvoiceNumber")
#         doc.orgaccountbalance = args.get("OrgAccountBalance")
#         doc.thirdpartytransid = args.get("ThirdPartyTransID")
#         doc.msisdn = args.get("MSISDN")
        
#         # Determine if this is B2B or C2B based on transaction characteristics
#         is_b2b_payment = (
#             # B2B payments often have specific transaction types
#             transaction_type in ["BusinessPayBill", "BusinessBuyGoods", "BusinessToBusinessTransfer"] or
#             # B2B payments may have sender business info instead of personal names
#             args.get("SenderName") or args.get("SenderBusinessName") or
#             # B2B payments might not have individual names
#             (not args.get("FirstName") and not args.get("LastName") and args.get("MSISDN")) or
#             # Check for B2B specific fields
#             args.get("SenderShortCode") or args.get("SenderTillNumber")
#         )
        
#         if is_b2b_payment:
#             # Handle as B2B payment
#             doc.payment_type = "B2B"
#             doc.firstname = args.get("SenderName") or args.get("SenderBusinessName")
#             doc.sender_business_name = args.get("SenderName") or args.get("SenderBusinessName")
#             doc.sender_shortcode = args.get("SenderShortCode")
#             doc.sender_till_number = args.get("SenderTillNumber") or args.get("PartyA")
#             # For B2B, MSISDN might be business contact number
#             doc.business_contact = args.get("MSISDN")
            
#             # Some B2B payments might still have names (authorized person)
#             if args.get("FirstName") or args.get("LastName"):
#                 doc.authorized_person = f"{args.get('FirstName', '')} {args.get('MiddleName', '')} {args.get('LastName', '')}".strip()
#         else:
#             # Handle as C2B payment (default)
#             doc.payment_type = "C2B"
#             doc.firstname = args.get("FirstName")
#             doc.middlename = args.get("MiddleName")
#             doc.lastname = args.get("LastName")
        
#         doc.insert(ignore_permissions=True)
#         frappe.db.commit()
        
#         # Log the payment type detection for debugging
#         frappe.logger().info(f"M-Pesa Payment Processed - Type: {doc.payment_type}, TransID: {doc.transid}")
        
#         return {"ResultCode": 0, "ResultDesc": "Accepted"}
        
#     except Exception as e:
#         frappe.log_error(frappe.get_traceback(), f"M-Pesa Confirmation Error: {str(e)[:140]}")
#         return {"ResultCode": 1, "ResultDesc": "Rejected"}

@frappe.whitelist(allow_guest=True)
def confirmation(**kwargs):
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
        context = {"ResultCode": 0, "ResultDesc": "Accepted"}
        return dict(context)
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), str(e)[:140])
        context = {"ResultCode": 1, "ResultDesc": "Rejected"}
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


# @frappe.whitelist()
# def get_mpesa_draft_payments(
#     company: str,
#     mode_of_payment: Optional[str] = None,
#     mobile_no: Optional[str] = None,
#     full_name: Optional[str] = None,
#     payment_methods_list: Optional[str] = None,
#     payment_type: Optional[str] = None,
# ) -> List[Dict[str, Any]]:
#     """
#     Get draft (unsubmitted) M-Pesa payments for a company, with optional filters.
#     Now supports filtering by payment type (C2B/B2B).
#     """
#     filters = {"company": company, "docstatus": 0}
    
#     if payment_type:
#         filters["payment_type"] = payment_type
#     if mode_of_payment:
#         filters["mode_of_payment"] = mode_of_payment
#     if mobile_no:
#         filters["msisdn"] = ["like", f"%{mobile_no}%"]
#     if full_name:
#         filters_or = [
#             {"full_name": ["like", f"%{full_name}%"]},
#             {"sender_business_name": ["like", f"%{full_name}%"]}
#         ]
        
#     if payment_methods_list:
#         try:
#             methods = json.loads(payment_methods_list)
#             if isinstance(methods, list):
#                 filters["mode_of_payment"] = ["in", methods]
#         except Exception:
#             pass

#     payments = frappe.get_all(
#         "Mpesa Payment Register",
#         filters=filters,
#         fields=[
#             "name",
#             "transid",
#             "msisdn as mobile_no",
#             "full_name",
#             "posting_date",
#             "transamount as amount",
#             "currency",
#             "mode_of_payment",
#             "company",
#             "payment_type",
#             "sender_business_name",
#             "sender_till_number",
#             "authorized_person",
#             "business_contact",
#         ],
#         order_by="posting_date desc",
#     )
#     return payments

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