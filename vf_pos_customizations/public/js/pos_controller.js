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
                //add button to create new invoice function is  POSController.prototype.new_invoice
                this.page.add_button(__('New Invoice'), () => this.new_invoice(), {
                    btn_class: "btn-default new-invoice-btn",
                });
            

                this.page.add_button(__('Payment Reconciliation'), () => frappe.set_route("pos-payments"), {
                    btn_class: "btn-default payment-recon-btn",
                });
            };

            POSController.prototype.new_invoice = function() {
                frappe.run_serially([
                    () => frappe.dom.freeze(),
                    () => this.make_new_invoice(),
                    () => this.item_selector.toggle_component(true),
                    () => this.cart.enable_customer_selection(),
                    () => this.payment.toggle_component(false),
                    () => this.item_details.toggle_component(false),
                    () => this.cart.toggle_component(true),
                    () => frappe.dom.unfreeze(),
                ]).then(() => {
                    frappe.show_alert({
                        message: __('New invoice created'),
                        indicator: 'green'
                    });
                });
            };

            clearInterval(interval);
        } else if (retries > 20) {
            // console.warn("VF POS: POS Controller not loaded, override failed.");
            clearInterval(interval);
        }
        retries++;
    }, 300);
});