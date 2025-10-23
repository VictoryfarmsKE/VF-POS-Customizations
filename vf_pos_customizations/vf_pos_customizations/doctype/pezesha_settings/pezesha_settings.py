# Copyright (c) 2025, Christine Kanga and contributors
# For license information, please see license.txt

import frappe
import requests
import json
from frappe.model.document import Document
from frappe import _
from frappe.integrations.utils import (make_post_request)

class PezeshaSettings(Document):
	def before_validate(self):
		if self.enable:
			try:
				response = make_post_request(
					url="https://dev.api.pezesha.com/oauth/token",
					headers = {
						'pezesha-apikey': 'Fo1CoRFD4k2SpwaQ3jZ1icv1403HbcGl',
						'Accept-Encoding': 'gzip, deflate'
					},
					data={
						"grant_type": "client_credentials",
						"client_id": self.client_id,
						"client_secret": self.client_secret_id,
						"provider": "users"				
					},
					auth=(
						self.client_id,
						self.get_password(fieldname="client_secret_id", raise_exception=False),
						),
					)
				self.authorization = response['access_token']
			except Exception as e:
				frappe.throw(_("Seems API Key or API Secret is wrong !!!"))



@frappe.whitelist()
def pezesha_loan_offer(customer=None, pos_profile=None):
	if not customer or not pos_profile:
		user = frappe.session.user
		pos_opening = frappe.db.get_value("POS Opening Entry", {"user": user, "status": "Open"}, "pos_profile")
		pos_profile = pos_profile or pos_opening
		customer = customer or frappe.db.get_value("POS Invoice", {"owner": user, "docstatus": 0}, "customer")

	pos = frappe.get_doc("POS Profile", pos_profile)
	pz_st = frappe.db.get_single_value('Pezesha Settings', 'authorization')
	url = 'https://dev.api.pezesha.com/mfi/v1/borrowers/options'
	headers = {
		'Authorization': f'Bearer {pz_st}',
		'pezesha-apikey': 'Fo1CoRFD4k2SpwaQ3jZ1icv1403HbcGl',
		'Accept-Encoding': 'gzip, deflate',
		'Content-Type': 'application/json'
	}
	data = {
		'channel': pos.custom_pezesha_channel_id,
		'identifier': customer
	}
	response = requests.post(url, headers=headers, json=data)
	if response.status_code == 200:
		try:
			dt = response.json()
			return dt
		except KeyError:
			frappe.msgprint("You already have a pending loan. Cannot apply for new loan until current one is cleared")
			return "You already have a pending loan. Cannot apply for new loan until current one is cleared"
	else:
		frappe.msgprint(f"Unable To Find Borrower <b>{customer}</b>")
	return response.status_code

@frappe.whitelist()
def pezesha_loan_application(data, pos_profile=None):
	if not pos_profile:
		user = frappe.session.user
		pos_opening = frappe.db.get_value("POS Opening Entry", {"user": user, "status": "Open"}, "pos_profile")
		pos_profile = pos_profile or pos_opening
		customer = None
		customer = customer or frappe.db.get_value("POS Invoice", {"owner": user, "docstatus": 0}, "customer")
  
	res = json.loads(data)
	pos = frappe.get_doc("POS Profile", pos_profile)
	pz_st = frappe.db.get_single_value('Pezesha Settings', 'authorization')
	url = 'https://dev.api.pezesha.com/mfi/v1/borrowers/loans'
	headers = {
		'Authorization': f'Bearer {pz_st}',
		'pezesha-apikey': 'Fo1CoRFD4k2SpwaQ3jZ1icv1403HbcGl',
		'Accept-Encoding': 'gzip, deflate',
		'Content-Type': 'application/json'
	}
	# Extract and validate loan payload
	amount = res.get('amount')
	duration = res.get('duration')
	interest = res.get('interest')
	rate = res.get('rate')
	fee = res.get('fee')

	try:
		amount_val = float(amount)
	except Exception:
		amount_val = None

	try:
		duration_val = int(duration)
	except Exception:
		duration_val = None

	# Enforce product constraints server-side for safety
	MAX_CAP = 200000
	MIN_14_DAY = 50000

	if amount_val is None or amount_val <= 0:
		return {"status": 400, "message": "Invalid loan amount."}
	if duration_val not in (7, 14):
		return {"status": 400, "message": "Invalid loan duration. Allowed values are 7 or 14 days."}
	if amount_val > MAX_CAP:
		return {"status": 400, "message": f"Amount exceeds the maximum limit of {MAX_CAP:,} KSH."}
	if duration_val == 14 and amount_val < MIN_14_DAY:
		return {"status": 400, "message": f"Minimum amount for 14-day product is {MIN_14_DAY:,} KSH."}

	data = {
		'channel': pos.custom_pezesha_channel_id,
		'pezesha_id': customer,
		'amount': amount_val,
		'duration': duration_val,
		'interest': interest,
		'rate': rate,
		'fee': fee
	}

	response = requests.post(url, headers=headers, json=data)
	return response.json()

@frappe.whitelist()
def pezesha_loan_status(customer=None, pos_profile=None):
	if not customer or not pos_profile:
		user = frappe.session.user
		pos_opening = frappe.db.get_value("POS Opening Entry", {"user": user, "status": "Open"}, "pos_profile")
		pos_profile = pos_profile or pos_opening
		customer = customer or frappe.db.get_value("POS Invoice", {"owner": user, "docstatus": 0}, "customer")

	pos = frappe.get_doc("POS Profile", pos_profile)
 
	pz_st = frappe.db.get_single_value('Pezesha Settings', 'authorization')
	url = 'https://dev.api.pezesha.com/mfi/v1/borrowers/latest'
	headers = {
		'Authorization': f'Bearer {pz_st}',
		'pezesha-apikey': 'Fo1CoRFD4k2SpwaQ3jZ1icv1403HbcGl',
		'Accept-Encoding': 'gzip, deflate',
		'Content-Type': 'application/json'
	}
	data = {
		'channel': pos.custom_pezesha_channel_id,
		'identifier': customer
	}
	response = requests.post(url, headers=headers, json=data)
	frappe.msgprint(response.json().get('message', 'No message from Pezesha'))
	return response.json().get('message', 'No message from Pezesha')
	# if response.status_code == 200:
	# 	try:
	# 		dt = response.json()
	# 		ddt = dt['data']
	# 		return ddt
	# 	except KeyError:
	# 		#log reponse for debugging
	# 		frappe.log_error(f"Response from Pezesha: {response.text}", "Pezesha Loan Status KeyError")
	# 		frappe.msgprint("Please Make a Loan Application")
	# 		return "Please Make a Loan Application"
	# else:
	# 	frappe.msgprint("Please Make a Loan Application")
	# 	return response.status_code
		
def corn():
	doc = frappe.get_doc('Pezesha Settings')
	if doc.enable:
		try:
			response = make_post_request(
				url="https://dev.api.pezesha.com/oauth/token",
				headers = {
					'pezesha-apikey': 'Fo1CoRFD4k2SpwaQ3jZ1icv1403HbcGl',
					'Accept-Encoding': 'gzip, deflate'
				},
				data={
					"grant_type": "client_credentials",
					"client_id": doc.client_id,
					"client_secret": doc.client_secret_id,
					"provider": "users"				
				},
				auth=(
					doc.client_id,
					doc.get_password(fieldname="client_secret_id", raise_exception=False),
					),
				)
			doc.db_set('authorization', response['access_token'])
		except Exception as e:
			frappe.throw(_("Seems API Key or API Secret is wrong !!!"))