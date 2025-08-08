
import frappe, erpnext, json
from frappe import _
from frappe.utils import nowdate, flt, getdate
from erpnext.accounts.party import get_party_account
from erpnext.accounts.utils import get_account_currency
from erpnext.accounts.doctype.journal_entry.journal_entry import (
    get_default_bank_cash_account,
)
from erpnext.setup.utils import get_exchange_rate
from erpnext.accounts.doctype.bank_account.bank_account import get_party_bank_account
from vf_pos_customizations.api.mpesa import submit_mpesa_payment
from erpnext.accounts.utils import get_outstanding_invoices as _get_outstanding_invoices
from operator import itemgetter
import ast


# def create_payment_entry(
#     company,
#     customer,
#     amount,
#     currency,
#     mode_of_payment,
#     reference_date=None,
#     reference_no=None,
#     posting_date=None,
#     cost_center=None,
#     submit=0,
# ):
#     """
#     Create a payment entry for a given customer and company.

#     Args:
#         company (str): Company for which the payment entry is being created.
#         customer (str): Customer for whom the payment entry is being created.
#         amount (float): Amount of the payment.
#         currency (str): Currency of the payment.
#         mode_of_payment (str): Mode of payment for the transaction.
#         reference_date (str, optional): Reference date for the payment entry. Defaults to None.
#         reference_no (str, optional): Reference number for the payment entry. Defaults to None.
#         posting_date (str, optional): Posting date for the payment entry. Defaults to None.
#         cost_center (str, optional): Cost center for the payment entry. Defaults to None.
#         submit (int, optional): Whether to submit the payment entry immediately. Defaults to 0.

#     Returns:
#         PaymentEntry: Newly created payment entry document.
#     """
#     # TODO : need to have a better way to handle currency
#     date = nowdate() if not posting_date else posting_date
#     party_type = "Customer"
#     party_account = get_party_account(party_type, customer, company)
#     party_account_currency = get_account_currency(party_account)
#     if party_account_currency != currency:
#         frappe.throw(
#             _(
#                 "Currency is not correct, party account currency is {party_account_currency} and transaction currency is {currency}"
#             ).format(party_account_currency=party_account_currency, currency=currency)
#         )
#     payment_type = "Receive"

#     bank = get_bank_cash_account(company, mode_of_payment)
#     company_currency = frappe.get_value("Company", company, "default_currency")
#     conversion_rate = get_exchange_rate(currency, company_currency, date, "for_selling")
#     paid_amount, received_amount = set_paid_amount_and_received_amount(
#         party_account_currency, bank, amount, payment_type, None, conversion_rate
#     )

#     pe = frappe.new_doc("Payment Entry")
#     pe.payment_type = payment_type
#     pe.company = company
#     pe.cost_center = cost_center or erpnext.get_default_cost_center(company)
#     pe.posting_date = date
#     pe.mode_of_payment = mode_of_payment
#     pe.party_type = party_type
#     pe.party = customer

#     pe.paid_from = party_account if payment_type == "Receive" else bank.account
#     pe.paid_to = party_account if payment_type == "Pay" else bank.account
#     pe.paid_from_account_currency = (
#         party_account_currency if payment_type == "Receive" else bank.account_currency
#     )
#     pe.paid_to_account_currency = (
#         party_account_currency if payment_type == "Pay" else bank.account_currency
#     )
#     pe.paid_amount = paid_amount
#     pe.received_amount = received_amount
#     pe.letter_head = frappe.get_value("Company", company, "default_letter_head")
#     pe.reference_date = reference_date
#     pe.reference_no = reference_no
#     if pe.party_type in ["Customer", "Supplier"]:
#         bank_account = get_party_bank_account(pe.party_type, pe.party)
#         pe.set("bank_account", bank_account)
#         pe.set_bank_account_data()

#     pe.setup_party_account_field()
#     pe.set_missing_values()

#     if party_account and bank:
#         pe.set_amounts()
#     if submit:
#         pe.docstatus = 1
#     pe.insert(ignore_permissions=True)
#     return pe


def get_bank_cash_account(company, mode_of_payment, bank_account=None):
    """
    Retrieve the default bank or cash account based on the company and mode of payment.

    Args:
        company (str): Company for which the account is being retrieved.
        mode_of_payment (str): Mode of payment for the transaction.
        bank_account (str, optional): Specific bank account to retrieve. Defaults to None.

    Returns:
        BankAccount: Default bank or cash account.
    """
    bank = get_default_bank_cash_account(
        company, "Bank", mode_of_payment=mode_of_payment, account=bank_account
    )

    if not bank:
        bank = get_default_bank_cash_account(
            company, "Cash", mode_of_payment=mode_of_payment, account=bank_account
        )

    return bank


def set_paid_amount_and_received_amount(
    party_account_currency,
    bank,
    outstanding_amount,
    payment_type,
    bank_amount,
    conversion_rate,
):
    """
    Set the paid amount and received amount based on currency and conversion rate.

    Args:
        party_account_currency (str): Currency of the party account.
        bank (BankAccount): Bank account used for the transaction.
        outstanding_amount (float): Outstanding amount to be paid/received.
        payment_type (str): Type of payment (Receive/Pay).
        bank_amount (float): Amount in the bank account currency (if available).
        conversion_rate (float): Conversion rate between currencies.

    Returns:
        float: Paid amount.
        float: Received amount.
    """
    paid_amount = received_amount = 0
    if party_account_currency == bank["account_currency"]:
        paid_amount = received_amount = abs(outstanding_amount)
    elif payment_type == "Receive":
        paid_amount = abs(outstanding_amount)
        if bank_amount:
            received_amount = bank_amount
        else:
            received_amount = paid_amount * conversion_rate

    else:
        received_amount = abs(outstanding_amount)
        if bank_amount:
            paid_amount = bank_amount
        else:
            # if party account currency and bank currency is different then populate paid amount as well
            paid_amount = received_amount * conversion_rate

    return paid_amount, received_amount


@frappe.whitelist()
def get_outstanding_invoices(company, currency, customer=None, pos_profile=None):
    """
    Optimized retrieval of outstanding invoices.
    """
    precision = frappe.get_precision("POS Invoice", "outstanding_amount") or 2

    filters = {
        "company": company,
        "docstatus": 0,
        "is_return": 0,
        "currency": currency,
        "outstanding_amount": (">", 0.5 / (10 ** precision))
    }

    if customer:
        filters["customer"] = customer
    if pos_profile:
        filters["pos_profile"] = pos_profile

    fields = [
        "name",
        "customer",
        "customer_name",
        "outstanding_amount",
        "grand_total",
        "due_date",
        "posting_date",
        "currency",
        "pos_profile"
    ]

    invoices = frappe.get_all("POS Invoice", filters=filters, fields=fields, order_by="due_date asc")

    return invoices

@frappe.whitelist()
def get_unallocated_payments(customer, company, currency, mode_of_payment=None):
    """
    Retrieve unallocated payments for a given customer, company, and currency.

    Args:
        customer (str): Customer for whom payments are being retrieved.
        company (str): Company for which payments are being retrieved.
        currency (str): Currency of the payments.
        mode_of_payment (str, optional): Mode of payment for filtering payments. Defaults to None.

    Returns:
        list: List of unallocated payments.
    """
    filters = {
        "party": customer,
        "company": company,
        "docstatus": 1,
        "party_type": "Customer",
        "payment_type": "Receive",
        "unallocated_amount": [">", 0],
        "paid_from_account_currency": currency,
    }
    if mode_of_payment:
        filters.update({"mode_of_payment": mode_of_payment})
    unallocated_payment = frappe.get_all(
        "Payment Entry",
        filters=filters,
        fields=[
            "name",
            "paid_amount",
            "party_name as customer_name",
            "received_amount",
            "posting_date",
            "unallocated_amount",
            "mode_of_payment",
            "paid_from_account_currency as currency",
        ],
        order_by="posting_date asc",
    )
    return unallocated_payment

@frappe.whitelist()
def process_pos_payment(payload):
    data = json.loads(payload)
    data = frappe._dict(data)

    # validate required data
    required_fields = {
        'customer': _("Customer is required"),
        'company': _("Company is required"),
        'currency': _("Currency is required")
    }
    
    for field, message in required_fields.items():
        if not data.get(field):
            frappe.throw(message)

    # Extract data once
    company = data.company
    currency = data.currency
    customer = data.customer
    today = nowdate()

    processed_invoices = []
    errors = []

    # Process selected invoices with payments
    if data.get('selected_invoices'):
        for invoice_data in data.selected_invoices:
            try:
                invoice_name = invoice_data.get("name")
                invoice_doc = frappe.get_doc("POS Invoice", invoice_name)
                
                # Track if invoice was modified
                invoice_modified = False
                
                # Process M-Pesa payments - use exact mode_of_payment match from selected payments
                if data.get('selected_mpesa_payments'):
                    for mpesa_payment in data.selected_mpesa_payments:
                        mpesa_amount = flt(mpesa_payment.get("amount", 0))
                        mpesa_mode = mpesa_payment.get("mode_of_payment")
                        
                        if mpesa_amount > 0 and mpesa_mode:
                            # Find exact matching mode of payment in invoice payments
                            payment_found = False
                            for payment in invoice_doc.payments:
                                if payment.mode_of_payment == mpesa_mode:
                                    payment.amount = mpesa_amount
                                    payment_found = True
                                    invoice_modified = True
                                    break
                            
                            # If no exact match found, create new payment row
                            if not payment_found:
                                new_payment_row = invoice_doc.append("payments", {})
                                new_payment_row.mode_of_payment = mpesa_mode
                                new_payment_row.amount = mpesa_amount
                                invoice_modified = True
                            
                            # Set M-Pesa receipt number using transaction ID
                            invoice_doc.mpesa_receipt_number = mpesa_payment.get("transid")
                            invoice_modified = True
                
                # Process other payment methods
                if data.get('payment_methods'):
                    for payment_method in data.payment_methods:
                        amount = flt(payment_method.get("amount"))
                        if amount <= 0:
                            continue
                        
                        mode_of_payment = payment_method.get("mode_of_payment")
                        
                        # Find exact matching mode of payment in invoice payments
                        payment_found = False
                        for payment in invoice_doc.payments:
                            if payment.mode_of_payment == mode_of_payment:
                                payment.amount = amount
                                payment_found = True
                                invoice_modified = True
                                break
                        
                        # If no exact match found, create new payment row
                        if not payment_found:
                            new_payment_row = invoice_doc.append("payments", {})
                            new_payment_row.mode_of_payment = mode_of_payment
                            new_payment_row.amount = amount
                            invoice_modified = True
                
                # Calculate totals and handle change if modified
                if invoice_modified:
                    # Set additional fields for payment rows
                    for payment in invoice_doc.payments:
                        if not payment.account:
                            # Get default account for mode of payment
                            bank_account = get_bank_cash_account(company, payment.mode_of_payment)
                            if bank_account:
                                payment.account = bank_account.get("account")
                    
                    # Calculate total paid amount
                    total_paid = sum(flt(p.amount) for p in invoice_doc.payments if flt(p.amount) > 0)
                    grand_total = flt(invoice_doc.grand_total)
                    invoice_doc.outstanding_amount = grand_total - total_paid
                    
                    # Handle change amount if paid more than grand total
                    change_amount = 0
                    if total_paid > grand_total:
                        change_amount = total_paid - grand_total
                        invoice_doc.change_amount = change_amount
                        invoice_doc.paid_amount = grand_total 
                    else:
                        invoice_doc.paid_amount = total_paid
                        invoice_doc.change_amount = 0

                    invoice_doc.run_method("calculate_taxes_and_totals")
                    
                    invoice_doc.save(ignore_permissions=True)
                
                    if invoice_doc.docstatus == 0:
                        invoice_doc.submit()
                    
                    # Submit M-Pesa payments if they exist
                    if data.get('selected_mpesa_payments'):
                        for mpesa_payment in data.selected_mpesa_payments:
                            try:
                                submit_mpesa_payment(mpesa_payment.get("name"), customer)
                            except Exception as e:
                                errors.append(f"Error submitting M-Pesa payment {mpesa_payment.get('name')}: {str(e)}")
                    
                    processed_invoices.append({
                        "name": invoice_doc.name,
                        "total_paid": total_paid,
                        "grand_total": grand_total,
                        "change_amount": change_amount,
                        "status": "Submitted" if invoice_doc.docstatus == 1 else "Submitted"
                    })
                
            except Exception as e:
                errors.append(f"Error processing invoice {invoice_data.get('name')}: {str(e)}")

    # Generate result message
    msg = _generate_pos_payment_result_message(processed_invoices, data.get('selected_mpesa_payments', []), data.get('payment_methods', []), errors)
    
    if msg:
        frappe.msgprint(msg)

    return {
        "processed_invoices": processed_invoices,
        "errors": errors,
        "success": len(processed_invoices) > 0 and len(errors) == 0
    }

def _generate_pos_payment_result_message(processed_invoices, selected_mpesa_payments, payment_methods, errors):
    """Generate HTML message for POS payment processing results"""
    msg = ""
    
    if processed_invoices:
        msg += "<h4>Processed POS Invoices</h4>"
        msg += "<table class='table table-bordered'>"
        msg += "<thead><tr><th>Invoice</th><th>Grand Total</th><th>Total Paid</th><th>Change</th><th>Outstanding</th><th>Status</th></tr></thead><tbody>"
        for invoice in processed_invoices:
            change_display = f"{invoice.get('change_amount', 0):.2f}" if invoice.get('change_amount', 0) > 0 else "-"
            msg += f"<tr><td>{invoice.get('name')}</td><td>{invoice.get('grand_total', 0):.2f}</td><td>{invoice.get('total_paid', 0):.2f}</td><td class='text-success'>{change_display}</td><td>{invoice.get('outstanding_amount', 0):.2f}</td><td>{invoice.get('status')}</td></tr>"
        msg += "</tbody></table>"
    
    if selected_mpesa_payments:
        msg += "<h4>M-Pesa Payments Applied</h4>"
        msg += "<table class='table table-bordered'>"
        msg += "<thead><tr><th>Transaction ID</th><th>Mode of Payment</th><th>Amount</th><th>Mobile</th></tr></thead><tbody>"
        for mpesa in selected_mpesa_payments:
            msg += f"<tr><td>{mpesa.get('transid')}</td><td>{mpesa.get('mode_of_payment')}</td><td>{mpesa.get('amount')}</td><td>{mpesa.get('mobile_no')}</td></tr>"
        msg += "</tbody></table>"
    
    if errors:
        msg += "<h4>Errors</h4>"
        msg += "<table class='table table-bordered'>"
        msg += "<thead><tr><th>Error</th></tr></thead><tbody>"
        for error in errors:
            msg += f"<tr><td>{error}</td></tr>"
        msg += "</tbody></table>"
    
    return msg

def get_bank_cash_account(company, mode_of_payment, bank_account=None):
    """
    Retrieve the default bank or cash account based on the company and mode of payment.
    """
    bank = get_default_bank_cash_account(
        company, "Bank", mode_of_payment=mode_of_payment, account=bank_account
    )

    if not bank:
        bank = get_default_bank_cash_account(
            company, "Cash", mode_of_payment=mode_of_payment, account=bank_account
        )
    
    if not bank:
        mode_of_payment_doc = frappe.get_doc("Mode of Payment", mode_of_payment)
        for account in mode_of_payment_doc.accounts:
            if account.company == company:
                bank = {
                    "account": account.default_account,
                    "account_currency": frappe.get_cached_value("Account", account.default_account, "account_currency")
                }
                break

    return bank or {}