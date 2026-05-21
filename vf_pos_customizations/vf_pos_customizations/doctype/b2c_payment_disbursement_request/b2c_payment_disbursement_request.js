// Copyright (c) 2026, Christine Kanga and contributors
// For license information, please see license.txt

frappe.ui.form.on("B2C Payment Disbursement Request", {
	refresh(frm) {
		if (frm.doc.status === "Failed") {
			frm.add_custom_button(
				"Retry Payment",
				() => {
					frappe.call({
						method: "retry_failed_payment",
						doc: frm.doc,
						args: {},
						callback: function (r) {
							if (!r.exc) {
								frm.reload_doc();
							}
						},
					});
				},
				"Actions"
			);
		}
	},
});
