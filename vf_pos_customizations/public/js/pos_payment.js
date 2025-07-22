frappe.require("erpnext/selling/page/point_of_sale/pos_payment.js", () => {
    // Override render_payment_section
    erpnext.PointOfSale.Payment.prototype.render_payment_section = function () {
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

    // Add new functions
    erpnext.PointOfSale.Payment.prototype.handle_pezesha_credit = async function () {
        const doc = this.events.get_frm().doc;
        const customer = doc.customer;
        const pos_profile = doc.pos_profile;
        const dialog = new frappe.ui.Dialog({
            title: __('Pezesha Loan Offer'),
            fields: [
                { fieldtype: 'HTML', fieldname: 'offer_html' },
            ],
            primary_action_label: __('Apply for Loan'),
            primary_action: () => {
                dialog.set_primary_action(__('Applying...'), null, true);
                this.apply_pezesha_loan(dialog, customer, pos_profile);
            },
            secondary_action_label: __('Close'),
            secondary_action: () => dialog.hide(),
        });
        dialog.show();
        dialog.set_message(__('Checking loan offer...'));
        frappe.call({
            method: "vf_pos_customizations.vf_pos_customizations.doctype.pezesha_settings.pezesha_settings.pezesha_loan_offer",
            args: { customer, pos_profile },
            callback: (r) => {
                if (r.message && r.message.data) {
                    const offer = r.message.data;
                    let html = `<div>${__('Loan Offer Available')}<br>`;
                    html += `${__('Max Amount')}: ${frappe.format(offer.amount, {fieldtype:'Currency'})}<br>`;
                    html += `${__('Interest')}: ${offer.interest_rate || offer.interest || ''}%<br>`;
                    html += `${__('Term')}: ${offer.duration || offer.term || ''} days</div>`;
                    dialog.set_value('offer_html', html);
                    dialog.set_primary_action(__('Apply for Loan'), () => {
                        dialog.set_primary_action(__('Applying...'), null, true);
                        this.apply_pezesha_loan(dialog, customer, pos_profile, offer);
                    });
                } else if (typeof r.message === 'string') {
                    dialog.set_value('offer_html', `<div>${r.message}</div>`);
                    dialog.set_primary_action(__('Close'), () => dialog.hide());
                } else {
                    dialog.set_value('offer_html', `<div>${__('No offer available.')}</div>`);
                    dialog.set_primary_action(__('Close'), () => dialog.hide());
                }
            }
        });
    };

    erpnext.PointOfSale.Payment.prototype.apply_pezesha_loan = function (dialog, customer, pos_profile, offer) {
       const data = {
            pezesha_customer_id: offer.pezesha_id || offer.pezesha_customer_id || offer.identifier,
            amount: offer.amount,
            duration: offer.duration || offer.term,
            interest: offer.interest || offer.interest_rate,
            rate: offer.rate || '',
            fee: offer.fee || ''
        };
        frappe.call({
            method: "vf_pos_customizations.vf_pos_customizations.doctype.pezesha_settings.pezesha_settings.pezesha_loan_application",
            args: { data: JSON.stringify(data), pos_profile },
            callback: (r) => {
                if (r.message && r.message.status) {
                    dialog.set_value('offer_html', `<div>${__('Loan application status')}: ${r.message.status}<br>${r.message.message || ''}</div>`);
                } else {
                    dialog.set_value('offer_html', `<div>${__('Loan application failed.')}</div>`);
                }
                dialog.set_primary_action(__('Close'), () => dialog.hide());
            }
        });
    };

    erpnext.PointOfSale.Payment.prototype.handle_pezesha_status = function () {
        const doc = this.events.get_frm().doc;
        const customer = doc.customer;
        const pos_profile = doc.pos_profile;
        const dialog = new frappe.ui.Dialog({
            title: __('Pezesha Loan Status'),
            fields: [
                { fieldtype: 'HTML', fieldname: 'status_html' },
            ],
            primary_action_label: __('Close'),
            primary_action: () => dialog.hide(),
        });
        dialog.show();
        dialog.set_message(__('Checking loan status...'));
        frappe.call({
            method: "vf_pos_customizations.vf_pos_customizations.doctype.pezesha_settings.pezesha_settings.pezesha_loan_status",
            args: { customer, pos_profile },
            callback: (r) => {
                if (r.message && r.message.loan_amount) {
                    let html = `<div>${__('Loan Amount')}: ${frappe.format(r.message.loan_amount, {fieldtype:'Currency'})}<br>`;
                    html += `${__('Status')}: ${r.message.status || ''}<br>`;
                    html += `${__('Due Date')}: ${r.message.due_date || ''}</div>`;
                    dialog.set_value('status_html', html);
                } else if (typeof r.message === 'string') {
                    dialog.set_value('status_html', `<div>${r.message}</div>`);
                } else {
                    dialog.set_value('status_html', `<div>${__('No loan status available.')}</div>`);
                }
            }
        });
    };
});
