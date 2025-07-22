frappe.require("erpnext/point_of_sale/public/js/pos_controller.js", () => {
	erpnext.PointOfSale.Controller.prototype.make_app() = function () {
		this.prepare_dom();
		this.prepare_components();
		this.prepare_menu();
		this.prepare_fullscreen_btn();
		this.make_new_invoice();
		this.prepare_vf_button();
	};

	erpnext.PointOfSale.Controller.prototype.prepare_vf_button() = function () {
		// New Invoice button
		this.page.add_button(__("New Invoice"), () => {
			this.new_invoice();
		}, { btn_class: "btn-default new-invoice-btn" });

		// Payment Reconciliation button
		this.page.add_button(__("Payment Reconciliation"), () => {
			frappe.set_route("pos-payments");
		}, { btn_class: "btn-default payment-recon-btn" });
	};

	erpnext.PointOfSale.Controller.prototype.new_invoice = function () {
		return frappe.run_serially([
			() => frappe.dom.freeze(),
			() => this.make_sales_invoice_frm(),
			() => this.set_pos_profile_data(),
			() => this.set_pos_profile_status(),
			() => { this.cart.reset_customer_selector(); },
			() => frappe.dom.unfreeze(),
		]);
	};

});