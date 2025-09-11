frappe.after_ajax(() => {
    let retries = 0;
    const interval = setInterval(() => {
        const Payment = erpnext?.PointOfSale?.Payment;
        if (Payment && !Payment.prototype.__vf_customized) {
            console.log("Overriding POS Payment...");
            Payment.prototype.__vf_customized = true;
            Payment.prototype.handle_pezesha_credit = function() {
                frappe.call({
                    method: "vf_pos_customizations.vf_pos_customizations.doctype.pezesha_settings.pezesha_settings.pezesha_loan_offer",
                    args: {
                        customer: this.customer,
                        pos_profile: this.pos_profile
                    },
                    callback: function(r) {
                        if (r.message) {
                            frappe.msgprint(JSON.stringify(r.message));
                        }
                    }
                });
            };
            Payment.prototype.handle_pezesha_status = function() {
                frappe.call({
                    method: "vf_pos_customizations.vf_pos_customizations.doctype.pezesha_settings.pezesha_settings.pezesha_loan_status",
                    args: {
                        customer: this.customer,
                        pos_profile: this.pos_profile
                    },
                    callback: function(r) {
                        if (r.message) {
                            frappe.msgprint(JSON.stringify(r.message));
                        }
                    }
                });
            };

            Payment.prototype.render_payment_section = function () {
                console.log("Custom render_payment_section called");
                this.render_payment_mode_dom();
                this.make_invoice_fields_control();
                this.update_totals_section();
                let $parent = this.$invoice_fields_section;
                if (!$parent || !$parent.length) {
                    $parent = $(".invoice_fields_section");
                } else {

                }
                if ($parent.length) {
                    if ($parent.find('.pezesha-btn').length === 0) {
                        $parent.append(
                            `<div class="pezesha-btn btn" style="margin-top: 16px; background: #73bf43; color: #fff;">${__("Credit Pezesha")}</div>`
                        );
                        $parent.find('.pezesha-btn').on('click', this.handle_pezesha_credit.bind(this));
                    }
                    if ($parent.find('.pezesha-status-btn').length === 0) {
                        $parent.append(
                            `<div class="pezesha-status-btn btn" style="margin-top: 8px; background: #73bf43; color: #fff;">${__("Pezesha Loan Status")}</div>`
                        );
                        $parent.find('.pezesha-status-btn').on('click', this.handle_pezesha_status.bind(this));
                    }
                } else {
                    console.warn("No parent found for Pezesha buttons.");
                }
            };
            clearInterval(interval);
        } else if (retries > 20) {
            clearInterval(interval);
        }
        retries++;
    }, 300);
});