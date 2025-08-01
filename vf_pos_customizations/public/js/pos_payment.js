/* eslint-disable no-unused-vars */
frappe.provide('vf_pos_customizations.PointOfSale');
vf_pos_customizations.PointOfSale.Payment = class {
	constructor({ events, wrapper }) {
		this.wrapper = wrapper;
		this.events = events;

		this.init_component();
	}

	init_component() {
		this.prepare_dom();
		this.initialize_numpad();
		this.bind_events();
		this.attach_shortcuts();
	}

	prepare_dom() {
		this.wrapper.append(
			`<section class="payment-container">
				<div class="section-label payment-section">${__("Payment Method")}</div>
				<div class="payment-modes"></div>
				<div class="fields-numpad-container">
					<div class="fields-section">
						<div class="section-label">${__("Additional Information")}</div>
						<div class="invoice-fields"></div>
					</div>
					<div class="number-pad"></div>
				</div>
				<div class="totals-section">
					<div class="totals"></div>
				</div>
				<div class="submit-order-btn">${__("Complete Order")}</div>
			</section>`
		);
		this.$component = this.wrapper.find(".payment-container");
		this.$payment_modes = this.$component.find(".payment-modes");
		this.$totals_section = this.$component.find(".totals-section");
		this.$totals = this.$component.find(".totals");
		this.$numpad = this.$component.find(".number-pad");
		this.$invoice_fields_section = this.$component.find(".fields-section");
	}

	make_invoice_fields_control() {
		this.reqd_invoice_fields = [];
		frappe.db.get_doc("POS Settings", undefined).then((doc) => {
			const fields = doc.invoice_fields;
			if (!fields.length) return;

			this.$invoice_fields = this.$invoice_fields_section.find(".invoice-fields");
			this.$invoice_fields.html("");
			const frm = this.events.get_frm();

			fields.forEach((df) => {
				this.$invoice_fields.append(
					`<div class="invoice_detail_field ${df.fieldname}-field" data-fieldname="${df.fieldname}"></div>`
				);
				let df_events = {
					onchange: function () {
						frm.set_value(this.df.fieldname, this.get_value());
					},
				};
				if (df.fieldtype == "Button") {
					df_events = {
						click: function () {
							if (frm.script_manager.has_handlers(df.fieldname, frm.doc.doctype)) {
								frm.script_manager.trigger(df.fieldname, frm.doc.doctype, frm.doc.docname);
							}
						},
					};
				}
				if (df.reqd && (df.fieldtype !== "Button" || !df.read_only)) {
					this.reqd_invoice_fields.push({ fieldname: df.fieldname, label: df.label });
				}

				this[`${df.fieldname}_field`] = frappe.ui.form.make_control({
					df: {
						...df,
						...df_events,
					},
					parent: this.$invoice_fields.find(`.${df.fieldname}-field`),
					render_input: true,
				});
				this[`${df.fieldname}_field`].set_value(frm.doc[df.fieldname]);
			});
		});
	}

	initialize_numpad() {
		const me = this;
		this.number_pad = new erpnext.PointOfSale.NumberPad({
			wrapper: this.$numpad,
			events: {
				numpad_event: function ($btn) {
					me.on_numpad_clicked($btn);
				},
			},
			cols: 3,
			keys: [
				[1, 2, 3],
				[4, 5, 6],
				[7, 8, 9],
				[".", 0, "Delete"],
			],
		});

		this.numpad_value = "";
	}

	on_numpad_clicked($btn) {
		const button_value = $btn.attr("data-button-value");

		highlight_numpad_btn($btn);
		this.numpad_value =
			button_value === "delete" ? this.numpad_value.slice(0, -1) : this.numpad_value + button_value;
		this.selected_mode.$input.get(0).focus();
		this.selected_mode.set_value(this.numpad_value);

		function highlight_numpad_btn($btn) {
			$btn.addClass("shadow-base-inner bg-selected");
			setTimeout(() => {
				$btn.removeClass("shadow-base-inner bg-selected");
			}, 100);
		}
	}

	bind_events() {
		const me = this;

		this.$payment_modes.on("click", ".mode-of-payment", function (e) {
			const mode_clicked = $(this);
			// if clicked element doesn't have .mode-of-payment class then return
			if (!$(e.target).is(mode_clicked)) return;

			const scrollLeft =
				mode_clicked.offset().left - me.$payment_modes.offset().left + me.$payment_modes.scrollLeft();
			me.$payment_modes.animate({ scrollLeft });

			const mode = mode_clicked.attr("data-mode");

			// hide all control fields and shortcuts
			$(`.mode-of-payment-control`).css("display", "none");
			$(`.cash-shortcuts`).css("display", "none");
			me.$payment_modes.find(`.pay-amount`).css("display", "inline");
			me.$payment_modes.find(`.loyalty-amount-name`).css("display", "none");

			// remove highlight from all mode-of-payments
			$(".mode-of-payment").removeClass("border-primary");

			if (mode_clicked.hasClass("border-primary")) {
				// clicked one is selected then unselect it
				mode_clicked.removeClass("border-primary");
				me.selected_mode = "";
			} else {
				// clicked one is not selected then select it
				mode_clicked.addClass("border-primary");
				mode_clicked.find(".mode-of-payment-control").css("display", "flex");
				mode_clicked.find(".cash-shortcuts").css("display", "grid");
				me.$payment_modes.find(`.${mode}-amount`).css("display", "none");
				me.$payment_modes.find(`.${mode}-name`).css("display", "inline");

				me.selected_mode = me[`${mode}_control`];
				me.selected_mode && me.selected_mode.$input.get(0).focus();
				me.auto_set_remaining_amount();
			}
		});

		frappe.ui.form.on("POS Invoice", "contact_mobile", (frm) => {
			const contact = frm.doc.contact_mobile;
			const request_button = $(this.request_for_payment_field?.$input[0]);
			if (contact) {
				request_button.removeClass("btn-default").addClass("btn-primary");
			} else {
				request_button.removeClass("btn-primary").addClass("btn-default");
			}
		});

		frappe.ui.form.on("POS Invoice", "coupon_code", (frm) => {
			if (frm.doc.coupon_code && !frm.applying_pos_coupon_code) {
				if (!frm.doc.ignore_pricing_rule) {
					frm.applying_pos_coupon_code = true;
					frappe.run_serially([
						() => (frm.doc.ignore_pricing_rule = 1),
						() => frm.trigger("ignore_pricing_rule"),
						() => (frm.doc.ignore_pricing_rule = 0),
						() => frm.trigger("apply_pricing_rule"),
						() => frm.save(),
						() => this.update_totals_section(frm.doc),
						() => (frm.applying_pos_coupon_code = false),
					]);
				} else if (frm.doc.ignore_pricing_rule) {
					frappe.show_alert({
						message: __("Ignore Pricing Rule is enabled. Cannot apply coupon code."),
						indicator: "orange",
					});
				}
			}
		});

		this.setup_listener_for_payments();

		this.$payment_modes.on("click", ".shortcut", function () {
			const value = $(this).attr("data-value");
			me.selected_mode.set_value(value);
		});

		this.$component.on("click", ".submit-order-btn", () => {
			const doc = this.events.get_frm().doc;
			const paid_amount = doc.paid_amount;
			const items = doc.items;

			if (!this.validate_reqd_invoice_fields()) {
				return;
			}

			if (!items.length || (paid_amount == 0 && doc.additional_discount_percentage != 100)) {
				const message = items.length
					? __("You cannot submit the order without payment.")
					: __("You cannot submit empty order.");
				frappe.show_alert({ message, indicator: "orange" });
				frappe.utils.play_sound("error");
				return;
			}

			this.events.submit_invoice();
		});

		frappe.ui.form.on("POS Invoice", "paid_amount", (frm) => {
			this.update_totals_section(frm.doc);

			// need to re calculate cash shortcuts after discount is applied
			const is_cash_shortcuts_invisible = !this.$payment_modes.find(".cash-shortcuts").is(":visible");
			this.attach_cash_shortcuts(frm.doc);
			!is_cash_shortcuts_invisible &&
				this.$payment_modes.find(".cash-shortcuts").css("display", "grid");
			this.render_payment_mode_dom();
		});

		frappe.ui.form.on("POS Invoice", "loyalty_amount", (frm) => {
			const formatted_currency = format_currency(frm.doc.loyalty_amount, frm.doc.currency);
			this.$payment_modes.find(`.loyalty-amount-amount`).html(formatted_currency);
		});

		frappe.ui.form.on("Sales Invoice Payment", "amount", (frm, cdt, cdn) => {
			// for setting correct amount after loyalty points are redeemed
			const default_mop = locals[cdt][cdn];
			const mode = this.sanitize_mode_of_payment(default_mop.mode_of_payment);
			if (this[`${mode}_control`] && this[`${mode}_control`].get_value() != default_mop.amount) {
				this[`${mode}_control`].set_value(default_mop.amount);
			}
		});
	}

	setup_listener_for_payments() {
		frappe.realtime.on("process_phone_payment", (data) => {
			const doc = this.events.get_frm().doc;
			const { response, amount, success, failure_message } = data;
			let message, title;

			if (success) {
				title = __("Payment Received");
				const grand_total = cint(frappe.sys_defaults.disable_rounded_total)
					? doc.grand_total
					: doc.rounded_total;
				if (amount >= grand_total) {
					frappe.dom.unfreeze();
					message = __("Payment of {0} received successfully.", [
						format_currency(amount, doc.currency, 0),
					]);
					this.events.submit_invoice();
					cur_frm.reload_doc();
				} else {
					message = __(
						"Payment of {0} received successfully. Waiting for other requests to complete...",
						[format_currency(amount, doc.currency, 0)]
					);
				}
			} else if (failure_message) {
				message = failure_message;
				title = __("Payment Failed");
			}

			frappe.msgprint({ message: message, title: title });
		});
	}

	auto_set_remaining_amount() {
		const doc = this.events.get_frm().doc;
		const grand_total = cint(frappe.sys_defaults.disable_rounded_total)
			? doc.grand_total
			: doc.rounded_total;
		const remaining_amount = grand_total - doc.paid_amount;
		const current_value = this.selected_mode ? this.selected_mode.get_value() : undefined;
		if (!current_value && remaining_amount > 0 && this.selected_mode) {
			this.selected_mode.set_value(remaining_amount);
		}
	}

	attach_shortcuts() {
		const ctrl_label = frappe.utils.is_mac() ? "⌘" : "Ctrl";
		this.$component.find(".submit-order-btn").attr("title", `${ctrl_label}+Enter`);
		frappe.ui.keys.on("ctrl+enter", () => {
			const payment_is_visible = this.$component.is(":visible");
			const active_mode = this.$payment_modes.find(".border-primary");
			if (payment_is_visible && active_mode.length) {
				this.$component.find(".submit-order-btn").click();
			}
		});

		frappe.ui.keys.add_shortcut({
			shortcut: "tab",
			action: () => {
				const payment_is_visible = this.$component.is(":visible");
				let active_mode = this.$payment_modes.find(".border-primary");
				active_mode = active_mode.length ? active_mode.attr("data-mode") : undefined;

				if (!active_mode) return;

				const mode_of_payments = Array.from(this.$payment_modes.find(".mode-of-payment")).map((m) =>
					$(m).attr("data-mode")
				);
				const mode_index = mode_of_payments.indexOf(active_mode);
				const next_mode_index = (mode_index + 1) % mode_of_payments.length;
				const next_mode_to_be_clicked = this.$payment_modes.find(
					`.mode-of-payment[data-mode="${mode_of_payments[next_mode_index]}"]`
				);

				if (payment_is_visible && mode_index != next_mode_index) {
					next_mode_to_be_clicked.click();
				}
			},
			condition: () =>
				this.$component.is(":visible") && this.$payment_modes.find(".border-primary").length,
			description: __("Switch Between Payment Modes"),
			ignore_inputs: true,
			page: cur_page.page.page,
		});
	}

	toggle_numpad() {
		// pass
	}

	render_payment_section() {
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
	}

	handle_pezesha_credit() {
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
	}

	apply_pezesha_loan(dialog, customer, pos_profile, offer = null) {
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
	}

	handle_pezesha_status() {
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
	}


	after_render() {
		const frm = this.events.get_frm();
		frm.script_manager.trigger("after_payment_render", frm.doc.doctype, frm.doc.docname);
	}

	edit_cart() {
		this.events.toggle_other_sections(false);
		this.toggle_component(false);
	}

	checkout() {
		const frm = this.events.get_frm();
		frm.cscript.calculate_outstanding_amount();
		frm.refresh_field("outstanding_amount");
		frm.refresh_field("paid_amount");
		frm.refresh_field("base_paid_amount");
		this.events.toggle_other_sections(true);
		this.toggle_component(true);

		this.render_payment_section();
		this.after_render();
	}

	toggle_remarks_control() {
		if (this.$remarks.find(".frappe-control").length) {
			this.$remarks.html("+ Add Remark");
		} else {
			this.$remarks.html("");
			this[`remark_control`] = frappe.ui.form.make_control({
				df: {
					label: __("Remark"),
					fieldtype: "Data",
					onchange: function () {},
				},
				parent: this.$totals_section.find(`.remarks`),
				render_input: true,
			});
			this[`remark_control`].set_value("");
		}
	}

	render_payment_mode_dom() {
		const doc = this.events.get_frm().doc;
		const payments = doc.payments;
		const currency = doc.currency;

		this.$payment_modes.html(
			`${payments
				.map((p, i) => {
					const mode = this.sanitize_mode_of_payment(p.mode_of_payment);
					const payment_type = p.type;
					const margin = i % 2 === 0 ? "pr-2" : "pl-2";
					const amount = p.amount > 0 ? format_currency(p.amount, currency) : "";

					return `
					<div class="payment-mode-wrapper">
						<div class="mode-of-payment" data-mode="${mode}" data-payment-type="${payment_type}">
							${p.mode_of_payment}
							<div class="${mode}-amount pay-amount">${amount}</div>
							<div class="${mode} mode-of-payment-control"></div>
						</div>
					</div>
				`;
				})
				.join("")}`
		);

		payments.forEach((p) => {
			const mode = this.sanitize_mode_of_payment(p.mode_of_payment);
			const me = this;
			this[`${mode}_control`] = frappe.ui.form.make_control({
				df: {
					label: p.mode_of_payment,
					fieldtype: "Currency",
					placeholder: __("Enter {0} amount.", [p.mode_of_payment]),
					onchange: function () {
						const current_value = frappe.model.get_value(p.doctype, p.name, "amount");
						if (current_value != this.value) {
							frappe.model
								.set_value(p.doctype, p.name, "amount", flt(this.value))
								.then(() => me.update_totals_section());

							const formatted_currency = format_currency(this.value, currency);
							me.$payment_modes.find(`.${mode}-amount`).html(formatted_currency);
						}
					},
				},
				parent: this.$payment_modes.find(`.${mode}.mode-of-payment-control`),
				render_input: true,
			});
			this[`${mode}_control`].toggle_label(false);
			this[`${mode}_control`].set_value(p.amount);
		});

		this.render_loyalty_points_payment_mode();

		this.attach_cash_shortcuts(doc);
	}

	focus_on_default_mop() {
		const doc = this.events.get_frm().doc;
		const payments = doc.payments;
		payments.forEach((p) => {
			const mode = this.sanitize_mode_of_payment(p.mode_of_payment);
			if (p.default) {
				setTimeout(() => {
					this.$payment_modes.find(`.${mode}.mode-of-payment-control`).parent().click();
				}, 500);
			}
		});
	}

	attach_cash_shortcuts(doc) {
		const grand_total = cint(frappe.sys_defaults.disable_rounded_total)
			? doc.grand_total
			: doc.rounded_total;
		const currency = doc.currency;

		const shortcuts = this.get_cash_shortcuts(flt(grand_total));

		this.$payment_modes.find(".cash-shortcuts").remove();
		let shortcuts_html = shortcuts
			.map((s) => {
				return `<div class="shortcut" data-value="${s}">${format_currency(s, currency)}</div>`;
			})
			.join("");

		this.$payment_modes
			.find('[data-payment-type="Cash"]')
			.find(".mode-of-payment-control")
			.after(`<div class="cash-shortcuts">${shortcuts_html}</div>`);
	}

	get_cash_shortcuts(grand_total) {
		let steps = [1, 5, 10];
		const digits = String(Math.round(grand_total)).length;

		steps = steps.map((x) => x * 10 ** (digits - 2));

		const get_nearest = (amount, x) => {
			let nearest_x = Math.ceil(amount / x) * x;
			return nearest_x === amount ? nearest_x + x : nearest_x;
		};

		return steps.reduce((finalArr, x) => {
			let nearest_x = get_nearest(grand_total, x);
			nearest_x = finalArr.indexOf(nearest_x) != -1 ? nearest_x + x : nearest_x;
			return [...finalArr, nearest_x];
		}, []);
	}

	render_loyalty_points_payment_mode() {
		const me = this;
		const doc = this.events.get_frm().doc;
		const { loyalty_program, loyalty_points, conversion_factor } = this.events.get_customer_details();

		this.$payment_modes.find(`.mode-of-payment[data-mode="loyalty-amount"]`).parent().remove();

		if (!loyalty_program) return;

		let description, read_only, max_redeemable_amount;
		if (!loyalty_points) {
			description = __("You don't have enough points to redeem.");
			read_only = true;
		} else {
			max_redeemable_amount = flt(
				flt(loyalty_points) * flt(conversion_factor),
				precision("loyalty_amount", doc)
			);
			description = __("You can redeem upto {0}.", [format_currency(max_redeemable_amount)]);
			read_only = false;
		}

		const margin = this.$payment_modes.children().length % 2 === 0 ? "pr-2" : "pl-2";
		const amount = doc.loyalty_amount > 0 ? format_currency(doc.loyalty_amount, doc.currency) : "";
		this.$payment_modes.append(
			`<div class="payment-mode-wrapper">
				<div class="mode-of-payment loyalty-card" data-mode="loyalty-amount" data-payment-type="loyalty-amount">
					Redeem Loyalty Points
					<div class="loyalty-amount-amount pay-amount">${amount}</div>
					<div class="loyalty-amount-name">${loyalty_program}</div>
					<div class="loyalty-amount mode-of-payment-control"></div>
				</div>
			</div>`
		);

		this["loyalty-amount_control"] = frappe.ui.form.make_control({
			df: {
				label: __("Redeem Loyalty Points"),
				fieldtype: "Currency",
				placeholder: __("Enter amount to be redeemed."),
				options: "company:currency",
				read_only,
				onchange: async function () {
					if (!loyalty_points) return;

					if (this.value > max_redeemable_amount) {
						frappe.show_alert({
							message: __("You cannot redeem more than {0}.", [
								format_currency(max_redeemable_amount),
							]),
							indicator: "red",
						});
						frappe.utils.play_sound("submit");
						me["loyalty-amount_control"].set_value(0);
						return;
					}
					const redeem_loyalty_points = this.value > 0 ? 1 : 0;
					await frappe.model.set_value(
						doc.doctype,
						doc.name,
						"redeem_loyalty_points",
						redeem_loyalty_points
					);
					frappe.model.set_value(
						doc.doctype,
						doc.name,
						"loyalty_points",
						parseInt(this.value / conversion_factor)
					);
				},
				description,
			},
			parent: this.$payment_modes.find(`.loyalty-amount.mode-of-payment-control`),
			render_input: true,
		});
		this["loyalty-amount_control"].toggle_label(false);

		// this.render_add_payment_method_dom();
	}

	render_add_payment_method_dom() {
		const docstatus = this.events.get_frm().doc.docstatus;
		if (docstatus === 0)
			this.$payment_modes.append(
				`<div class="w-full pr-2">
					<div class="add-mode-of-payment w-half text-grey mb-4 no-select pointer">+ Add Payment Method</div>
				</div>`
			);
	}

	update_totals_section(doc) {
		if (!doc) doc = this.events.get_frm().doc;
		const paid_amount = doc.paid_amount;
		const grand_total = cint(frappe.sys_defaults.disable_rounded_total)
			? doc.grand_total
			: doc.rounded_total;
		const remaining = grand_total - doc.paid_amount;
		const change = doc.change_amount || remaining <= 0 ? -1 * remaining : undefined;
		const currency = doc.currency;
		const label = __("Change Amount");

		this.$totals.html(
			`<div class="col">
				<div class="total-label">${__("Grand Total")}</div>
				<div class="value">${format_currency(grand_total, currency)}</div>
			</div>
			<div class="seperator-y"></div>
			<div class="col">
				<div class="total-label">${__("Paid Amount")}</div>
				<div class="value">${format_currency(paid_amount, currency)}</div>
			</div>
			<div class="seperator-y"></div>
			<div class="col">
				<div class="total-label">${label}</div>
				<div class="value">${format_currency(change || remaining, currency)}</div>
			</div>`
		);
	}

	toggle_component(show) {
		show ? this.$component.css("display", "flex") : this.$component.css("display", "none");
	}

	sanitize_mode_of_payment(mode_of_payment) {
		return mode_of_payment
			.replace(/ +/g, "_")
			.replace(/[^\p{L}\p{N}_-]/gu, "")
			.replace(/^[^_a-zA-Z\p{L}]+/u, "")
			.toLowerCase();
	}

	async unset_grand_total_to_default_mop() {
		const doc = this.events.get_frm().doc;
		let r = await frappe.db.get_value(
			"POS Profile",
			doc.pos_profile,
			"disable_grand_total_to_default_mop"
		);

		if (!r.message.disable_grand_total_to_default_mop) {
			this.focus_on_default_mop();
		}
	}

	validate_reqd_invoice_fields() {
		const doc = this.events.get_frm().doc;
		let validation_flag = true;
		for (let field of this.reqd_invoice_fields) {
			if (!doc[field.fieldname]) {
				validation_flag = false;
				frappe.show_alert({
					message: __("{0} is a mandatory field.", [field.label]),
					indicator: "orange",
				});
				frappe.utils.play_sound("error");
			}
		}
		return validation_flag;
	}
};


