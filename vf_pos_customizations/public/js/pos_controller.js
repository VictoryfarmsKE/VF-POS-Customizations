frappe.after_ajax(() => {
	let retries = 0;
	const interval = setInterval(() => {
		if (erpnext?.PointOfSale?.Controller) {
			//refresh page
			// if (retries > 0) {
			// 	window.location.reload();
			// }
			console.log("Overriding POS Controller...");

			erpnext.PointOfSale.Controller.prototype.make_app = function () {
				this.prepare_dom();
				this.prepare_components();
				this.prepare_menu();
				this.prepare_fullscreen_btn();
				this.make_new_invoice();
				this.prepare_vf_button();
			};

			erpnext.PointOfSale.Controller.prototype.prepare_vf_button = function () {
				this.page.add_button(__('New Invoice'), () => this.new_invoice(), {
					btn_class: "btn-default new-invoice-btn",
				});
				this.page.add_button(__('Payment Reconciliation'), () => frappe.set_route("pos-payments"), {
					btn_class: "btn-default payment-recon-btn",
				});
			};

			erpnext.PointOfSale.Controller.prototype.new_invoice = function () {
				return frappe.run_serially([
					() => frappe.dom.freeze(),
					() => this.make_sales_invoice_frm(),
					() => this.set_pos_profile_data(),
					() => this.set_pos_profile_status(),
					() => this.cart.reset_customer_selector(),
					() => frappe.dom.unfreeze(),
				]);
			};

			clearInterval(interval);
		} else if (retries > 20) {
			console.warn("POS Controller not loaded, override failed.");
			clearInterval(interval);
		}
		retries++;
	}, 300);
});
