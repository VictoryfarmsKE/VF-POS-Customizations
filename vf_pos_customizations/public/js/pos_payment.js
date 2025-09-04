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

                // Try to find the correct parent for buttons
                let $parent = this.$invoice_fields_section;
                if (!$parent || !$parent.length) {
                    $parent = $(".invoice_fields_section");
                } else {
                    // console.log("invoice_fields_section found:", $parent);
                    return $parent;
                }

                // Add Pezesha buttons if not present
                if ($parent.length) {
                    if ($parent.find('.pezesha-btn').length === 0) {
                        $parent.append(
                            `<div class="pezesha-btn btn" style="margin-top: 16px; background: #73bf43; color: #fff;">${__("Credit Pezesha")}</div>`
                        );
                        $parent.find('.pezesha-btn').on('click', () => this.handle_pezesha_credit());
                    }
                    if ($parent.find('.pezesha-status-btn').length === 0) {
                        $parent.append(
                            `<div class="pezesha-status-btn btn" style="margin-top: 8px; background: #73bf43; color: #fff;">${__("Pezesha Loan Status")}</div>`
                        );
                        $parent.find('.pezesha-status-btn').on('click', () => this.handle_pezesha_status());
                    }
                } else {
                    console.warn("No parent found for Pezesha buttons.");
                }
            };
            clearInterval(interval);
        } else if (retries > 20) {
            // console.warn("POS Payment not loaded, override failed.");
            clearInterval(interval);
        }
        retries++;
    }, 300);
});