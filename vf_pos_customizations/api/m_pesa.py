from __future__ import unicode_literals
import json
import requests
from requests.auth import HTTPBasicAuth

import frappe
from frappe import _
from frappe.utils import flt, get_request_site_address
from frappe.utils.background_jobs import enqueue
from frappe.utils import now_datetime
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
        frappe.set_user("Guest")

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
    except Exception as e:
        #Detect duplicate-key
        msg = str(e).lower()
        if any(k in msg for k in ("duplicate", "duplicate entry", "unique constraint", "unique" , "1062")):
            frappe.logger().warning(
                f"Mpesa insert skipped due to duplicate record for TransID {payment_data.get('transid')} - {msg[:200]}"
            )
            return
        #log as failed and trigger retry
        frappe.log_error(frappe.get_traceback(), "Delayed Mpesa Payment Insert Error")
        raise
    
    
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
    filters = {"company": company, "docstatus": 0, "mode_of_payment": ["is", "set"]}
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


@frappe.whitelist()
def trigger_transaction_status(mpesa_settings, transaction_id, remarks="OK"):
    """
    Trigger a transaction status check for a given Mpesa transaction.
    """
    from urllib.parse import urlparse
    try:
        site_address = frappe.utils.get_request_site_address(True)
        parsed_url = urlparse(site_address)
        site_url = f"{parsed_url.scheme}://{parsed_url.hostname}"

        queue_timeout_url = (
            site_url + "/api/method/vf_pos_customizations.api.m_pesa.handle_queue_timeout"
        )
        result_url = (
            site_url
            + "/api/method/vf_pos_customizations.api.m_pesa.handle_transaction_status_result"
        )

        settings = frappe.get_doc("Mpesa Settings", mpesa_settings)

        integration_request = frappe.get_doc(
            {
                "doctype": "Integration Request",
                "is_remote_request": 1,
                "integration_request_service": "Mpesa Transaction Status",
                "reference_doctype": "Mpesa Payment Register",
                "status": "Queued",
                "data": json.dumps(
                    {
                        "mpesa_settings": mpesa_settings,
                        "transaction_id": transaction_id,
                        "remarks": remarks,
                        "queue_timeout_url": queue_timeout_url,
                        "result_url": result_url,
                    }
                ),
                "method": "POST",
            }
        ).insert(ignore_permissions=True)
        frappe.db.commit()
        base_url = (
            "https://api.safaricom.co.ke"
            if not settings.sandbox
            else "https://sandbox.safaricom.co.ke"
        )

        token = get_token(
            settings.consumer_key, settings.get_password("consumer_secret"), base_url
        )

        payload = {
            "Initiator": settings.initiator_name,
            "SecurityCredential": settings.security_credential,
            "CommandID": "TransactionStatusQuery",
            "TransactionID": transaction_id,
            "PartyA": settings.business_shortcode
            if not settings.sandbox
            else settings.till_number,
            "IdentifierType": 4,
            "Remarks": remarks,
            "Occasion": "",
            "QueueTimeOutURL": queue_timeout_url,
            "ResultURL": result_url,
        }
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

        saf_url = f"{base_url}/mpesa/transactionstatus/v1/query"
        try:
            r = requests.post(saf_url, headers=headers, json=payload, timeout=30)
            r.raise_for_status()
            try:
                response = r.json()
            except ValueError:
                response = {"errorCode": "invalid_json", "errorMessage": r.text}

        except requests.exceptions.RequestException as re:
            frappe.log_error(frappe.get_traceback(), f"Mpesa TransactionStatus HTTP Error: {str(re)[:140]}")
            response = {"errorCode": "http_error", "errorMessage": str(re)}

        status = "Completed" if response.get("ResponseCode") == "0" else "Failed"
        output = frappe.as_json(response)
        if status == "Completed":
            message_text = response.get("ResponseDescription", "Transaction status check completed")
        else:
            message_text = (
                response.get("errorMessage")
                or response.get("error")
                or response.get("ResponseDescription")
                or output
            )

        frappe.db.set_value(
            "Integration Request",
            integration_request.name,
            {
                "status": status,
                "output": output,
                "request_id": response.get("OriginatorConversationID"),
            },
            update_modified=True,
        )
        frappe.db.commit()

        if status == "Completed":
            return {"status": "success", "message": message_text, "data": response}
        else:
            return {"status": "error", "message": message_text, "data": response}

    except Exception as e:
        if "integration_request" in locals():
            frappe.db.set_value(
                "Integration Request",
                integration_request.name,
                {"status": "Failed", "output": str(e)},
                update_modified=True,
            )
            frappe.db.commit()

        frappe.log_error(title="Mpesa Transaction Status Error", message=str(e))
        return {"status": "error", "message": str(e)}


@frappe.whitelist(allow_guest=True)
def handle_transaction_status_result():
    #log when called
    frappe.log_error("Mpesa Transaction status Webhook called", "Mpesa Webhook Info")
    """Handle the transaction status response from Mpesa for vf_pos_customizations."""

    try:
        response = frappe.request.data
        response_data = json.loads(response)

        if not response_data:
            frappe.log_error("Empty response from Mpesa", "Mpesa Webhook Error")
            return {"ResultCode": 1, "ResultDesc": "Empty response data"}

        correlation_id = response_data.get("Result", {}).get("OriginatorConversationID")
        integration_request = frappe.db.get_value(
            "Integration Request",
            {
                "integration_request_service": "Mpesa Transaction Status",
                "request_id": correlation_id,
            },
            "name",
        )
        frappe.db.commit()

        if not integration_request:
            frappe.log_error(
                "Mpesa Webhook Error",
                f"Could not find Integration Request for OriginatorConversationID {correlation_id}",
            )
            return {"ResultCode": 1, "ResultDesc": "Integration Request not found"}

        # Process result parameters
        ir_owner = frappe.db.get_value("Integration Request", integration_request, "owner")
        result = response_data.get("Result", {})
        result_parameters = result.get("ResultParameters", {}).get("ResultParameter", [])
        result_params = {p.get("Key", ""): p.get("Value", "") for p in result_parameters if "Key" in p}

        result_code = result.get("ResultCode")
        result_desc = result.get("ResultDesc", "Unknown Error")
        receipt_no = result_params.get("ReceiptNo") or result_params.get("MpesaReceiptNumber")

        if result_code != 0:
            error_msg = f"Result Code {result_code}: {result_desc}"
            frappe.db.set_value(
                "Integration Request",
                integration_request,
                {"status": "Failed", "error": error_msg},
                update_modified=True,
            )
            frappe.db.commit()

            frappe.publish_realtime(
                event="mpesa_transaction_status_update",
                message={
                    "status": "error",
                    "title": "Transaction Failed",
                    "message": error_msg,
                    "result_code": result_code,
                    "result_desc": result_desc,
                },
                user=ir_owner,
            )

            return {"ResultCode": 0, "ResultDesc": "Accepted (failed transaction)"}

        # Prevent duplicate
        if receipt_no and frappe.db.exists("Mpesa Payment Register", {"transid": receipt_no}):
            error_msg = f"Duplicate transaction: Receipt No {receipt_no} already exists"
            frappe.db.set_value(
                "Integration Request",
                integration_request,
                {"status": "Failed", "error": error_msg},
                update_modified=True,
            )
            frappe.db.commit()

            frappe.log_error(
                title=f"Duplicate M-Pesa Transaction: {receipt_no}",
                message=f"Receipt: {receipt_no}\nFull Data: {json.dumps(response_data, indent=2)}",
            )

            frappe.publish_realtime(
                event="mpesa_transaction_status_update",
                message={
                    "status": "warning",
                    "title": "Duplicate M-Pesa Transaction",
                    "message": error_msg,
                    "receipt_no": receipt_no,
                },
                user=ir_owner,
            )

            return {"ResultCode": 0, "ResultDesc": "Duplicate transaction rejected"}

        try:
            mpesa_doc = frappe.new_doc("Mpesa Payment Register")
            mpesa_doc.full_name = result_params.get("DebitPartyName", "")
            mpesa_doc.transactiontype = result_params.get("ReasonType", "")
            mpesa_doc.transid = receipt_no or result_params.get("TransactionID", "")
            mpesa_doc.transtime = result_params.get("InitiatedTime", "")
            mpesa_doc.transamount = float(result_params.get("Amount", 0.0) or 0.0)
            mpesa_doc.businessshortcode = result_params.get("CreditPartyName", "")
            mpesa_doc.billrefnumber = mpesa_doc.transid
            mpesa_doc.invoicenumber = result_params.get("TransactionID", "")
            mpesa_doc.orgaccountbalance = result_params.get("DebitAccountType", "")
            mpesa_doc.thirdpartytransid = result.get("OriginatorConversationID", "")
            debit_party = result_params.get("DebitPartyName", "").split(" - ")
            mpesa_doc.msisdn = debit_party[0] if debit_party else ""

            mpesa_doc.insert(ignore_permissions=True)
            frappe.db.commit()

            success_msg = "Transaction processed successfully"
            frappe.db.set_value(
                "Integration Request",
                integration_request,
                {"status": "Completed", "output": success_msg, "reference_docname": mpesa_doc.name},
                update_modified=True,
            )
            frappe.db.commit()

            frappe.publish_realtime(
                event="mpesa_transaction_status_update",
                message={
                    "status": "success",
                    "title": "Transaction Successful",
                    "message": success_msg,
                    "receipt_no": receipt_no,
                    "document_name": mpesa_doc.name,
                },
                user=ir_owner,
            )

            return {"ResultCode": 0, "ResultDesc": success_msg}

        except Exception as e:
            error_message = f"Mpesa Processing Error: {str(e)}"
            frappe.db.set_value(
                "Integration Request",
                integration_request,
                {"status": "Failed", "error": error_message},
                update_modified=True,
            )
            frappe.db.commit()

            frappe.log_error(
                "Mpesa Transaction Processing Error",
                f"{error_message}\nData: {json.dumps(response_data)}",
            )

            frappe.publish_realtime(
                event="mpesa_transaction_status_update",
                message={"status": "error", "title": "Processing Error", "message": error_message},
                user=ir_owner,
            )

            return {"ResultCode": 1, "ResultDesc": "Processing failed"}

    except json.JSONDecodeError as e:
        frappe.log_error("Mpesa Webhook Error", f"Failed to decode JSON from Mpesa response: {e}")
        return {"ResultCode": 1, "ResultDesc": "Invalid JSON data"}
    except Exception as e:
        frappe.log_error("Mpesa Webhook Error", f"Error in Mpesa webhook: {e}")
        return {"ResultCode": 1, "ResultDesc": "Processing error"}


@frappe.whitelist(allow_guest=True)
def handle_queue_timeout():
    """Handle the timeout response from Mpesa for vf_pos_customizations."""
    try:
        response = frappe.request.data
        response_data = json.loads(response)

        frappe.log_error(
            title="Mpesa Queue Timeout",
            message=f"Timeout response received: {frappe.as_json(response_data)}",
        )

        return {"status": "timeout", "message": "Timeout response logged successfully."}

    except json.JSONDecodeError:
        frappe.log_error(title="Mpesa Timeout Error", message="Failed to decode JSON from timeout response.")
        return {"status": "error", "message": "Invalid JSON received."}

    except Exception as e:
        error_message = f"Mpesa Timeout Error: {str(e)}"
        frappe.log_error(title="Mpesa Timeout Error", message=error_message)
        return {"status": "error", "message": str(e)}
