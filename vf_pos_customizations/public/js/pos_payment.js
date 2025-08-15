frappe.after_ajax(() => {
    let retries = 0;
    const interval = setInterval(() => {
        const Payment = erpnext?.PointOfSale?.Payment;
        if (Payment && !Payment.prototype.__vf_customized) {
            console.log("Overriding POS Payment...");
            Payment.prototype.__vf_customized = true;

            Payment.prototype.render_payment_section = function () {
                console.log("Custom render_payment_section called");
                this.render_payment_mode_dom();
                this.make_invoice_fields_control();
                this.update_totals_section();
                this.unset_grand_total_to_default_mop();

                // Add Pezesha buttons
                const $pezeshaBtn = this.$invoice_fields_section.find('.pezesha-btn');
                const $pezeshaStatusBtn = this.$invoice_fields_section.find('.pezesha-status-btn');
                if (!$pezeshaBtn.length) {
                    this.$invoice_fields_section.find('.invoice-fields').after(
                        `<div class="pezesha-btn btn" style="margin-top: 16px; background: #73bf43; color: #fff;">${__("Credit Pezesha")}</div>`
                    );
                    this.$invoice_fields_section.find('.pezesha-btn').on('click', () => this.handle_pezesha_credit());
                }
                if (!$pezeshaStatusBtn.length) {
                    this.$invoice_fields_section.find('.pezesha-btn').after(
                        `<div class="pezesha-status-btn btn" style="margin-top: 8px; background: #73bf43; color: #fff;">${__("Pezesha Loan Status")}</div>`
                    );
                    this.$invoice_fields_section.find('.pezesha-status-btn').on('click', () => this.handle_pezesha_status());
                }
            };
            clearInterval(interval);
        } else if (retries > 20) {
            console.warn("POS Payment not loaded, override failed.");
            clearInterval(interval);
        }
        retries++;
    }, 300);
});