frappe.after_ajax(() => {
	let retries = 0;
	const interval = setInterval(() => {
		if (erpnext?.PointOfSale?.PastOrderList) {
			//refresh page
			if (retries > 0) {
				window.location.reload();
			}
			console.log("Overriding POS PastOrderList...");

            erpnext.PointOfSale.PastOrderList.prototype.prepare_dom = function () {
                this.wrapper.append(
                    `<section class="past-order-list">
                        <div class="filter-section">
                            <div class="label">${__("Recent Orders")}</div>
                            <div class="search-field"></div>
                            <div class="status-field"></div>
                            <div class="posprofile-field"></div>
                            
                        </div>
                        <div class="invoices-container"></div>
                    </section>`
                );

                this.$component = this.wrapper.find(".past-order-list");
                this.$invoices_container = this.$component.find(".invoices-container");
            };

            erpnext.PointOfSale.PastOrderList.prototype.make_filter_section = function () {
                const me = this;
                this.search_field = frappe.ui.form.make_control({
                    df: {
                        label: __("Search"),
                        fieldtype: "Data",
                        placeholder: __("Search by invoice id or customer name"),
                    },
                    parent: this.$component.find(".search-field"),
                    render_input: true,
                });
                this.status_field = frappe.ui.form.make_control({
                    df: {
                        label: __("Invoice Status"),
                        fieldtype: "Select",
                        options: `Draft\nPaid\nConsolidated\nReturn`,
                        placeholder: __("Filter by invoice status"),
                        onchange: function () {
                            if (me.$component.is(":visible")) me.refresh_list();
                        },
                    },
                    parent: this.$component.find(".status-field"),
                    render_input: true,
                });
                this.posprofile_field = frappe.ui.form.make_control({
                    df: {
                        label: __("POS Profile"),
                        fieldtype: "Link",
                        options: "POS Profile",
                        onchange: function () {
                            if (me.$component.is(":visible")) me.refresh_list();
                        },
                    },

                    parent: this.$component.find(".posprofile-field"),
                    render_input: true,
                });
                this.search_field.toggle_label(false);
                this.status_field.toggle_label(false);
                this.status_field.set_value("Draft");
                this.posprofile_field.toggle_label(false);
                // Fetch current POS profile from API and set the value
                frappe.call({
                    method: "erpnext.selling.page.point_of_sale.point_of_sale.check_opening_entry",
                    args: {
                        user: frappe.session.user
                    },
                    callback: function (r) {
                        if (r.message && r.message.length && r.message[0].pos_profile) {
                            me.posprofile_field.set_value(r.message[0].pos_profile);
                        }
                    }
                });

            };

            erpnext.PointOfSale.PastOrderList.prototype.refresh_list = function () {
                frappe.dom.freeze();
                this.events.reset_summary();
                const search_term = this.search_field.get_value();
                const status = this.status_field.get_value();
                const pos_profile = this.posprofile_field.get_value();

                this.$invoices_container.html("");

                return frappe.call({
                    method: "vf_pos_customizations.custom.point_of_sale.get_past_order_list",
                    freeze: true,
                    args: { search_term, status, pos_profile},
                    callback: (response) => {
                        frappe.dom.unfreeze();
                        response.message.forEach((invoice) => {
                            const invoice_html = this.get_invoice_html(invoice);
                            this.$invoices_container.append(invoice_html);
                        });
                    },
                });
            };
        clearInterval(interval);
		} else if (retries > 20) {
			console.warn("POS Past Order List not loaded, override failed.");
			clearInterval(interval);
		}
		retries++;
	}, 300);
});
