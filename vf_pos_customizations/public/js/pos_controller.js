frappe.after_ajax(() => {
    let retries = 0;
    const interval = setInterval(() => {
        const POSController = erpnext?.PointOfSale?.Controller;
        if (POSController && !POSController.prototype.__vf_customized) {
            console.log("VF POS: Overriding POS Controller...");

            // Mark as patched to avoid double patching
            POSController.prototype.__vf_customized = true;

            // Patch make_app to add custom buttons
            const _make_app = POSController.prototype.make_app;
            POSController.prototype.make_app = function () {
                _make_app.apply(this, arguments);
                this.prepare_vf_button();
            };

            POSController.prototype.prepare_vf_button = function () {
                // this.page.add_button(__('New Invoice'), () => this.new_invoice(), {
                //     btn_class: "btn-default new-invoice-btn",
                // });
                this.page.add_button(__('Payment Reconciliation'), () => frappe.set_route("pos-payments"), {
                    btn_class: "btn-default payment-recon-btn",
                });
            };

            POSController.prototype.new_invoice = function () {
                return frappe.run_serially([
                    () => frappe.dom.freeze(),
                    () => this.make_sales_invoice_frm(),
                    () => this.set_pos_profile_data(),
                    () => this.set_pos_profile_status(),
                    () => this.cart.reset_customer_selector && this.cart.reset_customer_selector(),
                    () => frappe.dom.unfreeze(),
                ]);
            };

            clearInterval(interval);
        } else if (retries > 20) {
            console.warn("VF POS: POS Controller not loaded, override failed.");
            clearInterval(interval);
        }
        retries++;
    }, 300);
});