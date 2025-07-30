(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };

  // ../vf_pos_customizations/vf_pos_customizations/public/js/pos_payment.js
  frappe.provide("vf_pos_customizations.PointOfSale");
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
      frappe.db.get_doc("POS Settings", void 0).then((doc) => {
        const fields = doc.invoice_fields;
        if (!fields.length)
          return;
        this.$invoice_fields = this.$invoice_fields_section.find(".invoice-fields");
        this.$invoice_fields.html("");
        const frm = this.events.get_frm();
        fields.forEach((df) => {
          this.$invoice_fields.append(
            `<div class="invoice_detail_field ${df.fieldname}-field" data-fieldname="${df.fieldname}"></div>`
          );
          let df_events = {
            onchange: function() {
              frm.set_value(this.df.fieldname, this.get_value());
            }
          };
          if (df.fieldtype == "Button") {
            df_events = {
              click: function() {
                if (frm.script_manager.has_handlers(df.fieldname, frm.doc.doctype)) {
                  frm.script_manager.trigger(df.fieldname, frm.doc.doctype, frm.doc.docname);
                }
              }
            };
          }
          if (df.reqd && (df.fieldtype !== "Button" || !df.read_only)) {
            this.reqd_invoice_fields.push({ fieldname: df.fieldname, label: df.label });
          }
          this[`${df.fieldname}_field`] = frappe.ui.form.make_control({
            df: __spreadValues(__spreadValues({}, df), df_events),
            parent: this.$invoice_fields.find(`.${df.fieldname}-field`),
            render_input: true
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
          numpad_event: function($btn) {
            me.on_numpad_clicked($btn);
          }
        },
        cols: 3,
        keys: [
          [1, 2, 3],
          [4, 5, 6],
          [7, 8, 9],
          [".", 0, "Delete"]
        ]
      });
      this.numpad_value = "";
    }
    on_numpad_clicked($btn) {
      const button_value = $btn.attr("data-button-value");
      highlight_numpad_btn($btn);
      this.numpad_value = button_value === "delete" ? this.numpad_value.slice(0, -1) : this.numpad_value + button_value;
      this.selected_mode.$input.get(0).focus();
      this.selected_mode.set_value(this.numpad_value);
      function highlight_numpad_btn($btn2) {
        $btn2.addClass("shadow-base-inner bg-selected");
        setTimeout(() => {
          $btn2.removeClass("shadow-base-inner bg-selected");
        }, 100);
      }
    }
    bind_events() {
      const me = this;
      this.$payment_modes.on("click", ".mode-of-payment", function(e) {
        const mode_clicked = $(this);
        if (!$(e.target).is(mode_clicked))
          return;
        const scrollLeft = mode_clicked.offset().left - me.$payment_modes.offset().left + me.$payment_modes.scrollLeft();
        me.$payment_modes.animate({ scrollLeft });
        const mode = mode_clicked.attr("data-mode");
        $(`.mode-of-payment-control`).css("display", "none");
        $(`.cash-shortcuts`).css("display", "none");
        me.$payment_modes.find(`.pay-amount`).css("display", "inline");
        me.$payment_modes.find(`.loyalty-amount-name`).css("display", "none");
        $(".mode-of-payment").removeClass("border-primary");
        if (mode_clicked.hasClass("border-primary")) {
          mode_clicked.removeClass("border-primary");
          me.selected_mode = "";
        } else {
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
        var _a;
        const contact = frm.doc.contact_mobile;
        const request_button = $((_a = this.request_for_payment_field) == null ? void 0 : _a.$input[0]);
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
              () => frm.doc.ignore_pricing_rule = 1,
              () => frm.trigger("ignore_pricing_rule"),
              () => frm.doc.ignore_pricing_rule = 0,
              () => frm.trigger("apply_pricing_rule"),
              () => frm.save(),
              () => this.update_totals_section(frm.doc),
              () => frm.applying_pos_coupon_code = false
            ]);
          } else if (frm.doc.ignore_pricing_rule) {
            frappe.show_alert({
              message: __("Ignore Pricing Rule is enabled. Cannot apply coupon code."),
              indicator: "orange"
            });
          }
        }
      });
      this.setup_listener_for_payments();
      this.$payment_modes.on("click", ".shortcut", function() {
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
        if (!items.length || paid_amount == 0 && doc.additional_discount_percentage != 100) {
          const message = items.length ? __("You cannot submit the order without payment.") : __("You cannot submit empty order.");
          frappe.show_alert({ message, indicator: "orange" });
          frappe.utils.play_sound("error");
          return;
        }
        this.events.submit_invoice();
      });
      frappe.ui.form.on("POS Invoice", "paid_amount", (frm) => {
        this.update_totals_section(frm.doc);
        const is_cash_shortcuts_invisible = !this.$payment_modes.find(".cash-shortcuts").is(":visible");
        this.attach_cash_shortcuts(frm.doc);
        !is_cash_shortcuts_invisible && this.$payment_modes.find(".cash-shortcuts").css("display", "grid");
        this.render_payment_mode_dom();
      });
      frappe.ui.form.on("POS Invoice", "loyalty_amount", (frm) => {
        const formatted_currency = format_currency(frm.doc.loyalty_amount, frm.doc.currency);
        this.$payment_modes.find(`.loyalty-amount-amount`).html(formatted_currency);
      });
      frappe.ui.form.on("Sales Invoice Payment", "amount", (frm, cdt, cdn) => {
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
          const grand_total = cint(frappe.sys_defaults.disable_rounded_total) ? doc.grand_total : doc.rounded_total;
          if (amount >= grand_total) {
            frappe.dom.unfreeze();
            message = __("Payment of {0} received successfully.", [
              format_currency(amount, doc.currency, 0)
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
        frappe.msgprint({ message, title });
      });
    }
    auto_set_remaining_amount() {
      const doc = this.events.get_frm().doc;
      const grand_total = cint(frappe.sys_defaults.disable_rounded_total) ? doc.grand_total : doc.rounded_total;
      const remaining_amount = grand_total - doc.paid_amount;
      const current_value = this.selected_mode ? this.selected_mode.get_value() : void 0;
      if (!current_value && remaining_amount > 0 && this.selected_mode) {
        this.selected_mode.set_value(remaining_amount);
      }
    }
    attach_shortcuts() {
      const ctrl_label = frappe.utils.is_mac() ? "\u2318" : "Ctrl";
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
          active_mode = active_mode.length ? active_mode.attr("data-mode") : void 0;
          if (!active_mode)
            return;
          const mode_of_payments = Array.from(this.$payment_modes.find(".mode-of-payment")).map(
            (m) => $(m).attr("data-mode")
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
        condition: () => this.$component.is(":visible") && this.$payment_modes.find(".border-primary").length,
        description: __("Switch Between Payment Modes"),
        ignore_inputs: true,
        page: cur_page.page.page
      });
    }
    toggle_numpad() {
    }
    render_payment_section() {
      this.render_payment_mode_dom();
      this.make_invoice_fields_control();
      this.update_totals_section();
      this.unset_grand_total_to_default_mop();
      const $pezeshaBtn = this.$invoice_fields_section.find(".pezesha-btn");
      const $pezeshaStatusBtn = this.$invoice_fields_section.find(".pezesha-status-btn");
      if (!$pezeshaBtn.length) {
        this.$invoice_fields_section.find(".invoice-fields").after(
          `<div class="pezesha-btn btn" style="margin-top: 16px; background: #73bf43; color: #fff;">${__("Credit Pezesha")}</div>`
        );
        this.$invoice_fields_section.find(".pezesha-btn").on("click", () => this.handle_pezesha_credit());
      }
      if (!$pezeshaStatusBtn.length) {
        this.$invoice_fields_section.find(".pezesha-btn").after(
          `<div class="pezesha-status-btn btn" style="margin-top: 8px; background: #73bf43; color: #fff;">${__("Pezesha Loan Status")}</div>`
        );
        this.$invoice_fields_section.find(".pezesha-status-btn").on("click", () => this.handle_pezesha_status());
      }
    }
    handle_pezesha_credit() {
      const doc = this.events.get_frm().doc;
      const customer = doc.customer;
      const pos_profile = doc.pos_profile;
      const dialog = new frappe.ui.Dialog({
        title: __("Pezesha Loan Offer"),
        fields: [
          { fieldtype: "HTML", fieldname: "offer_html" }
        ],
        primary_action_label: __("Apply for Loan"),
        primary_action: () => {
          dialog.set_primary_action(__("Applying..."), null, true);
          this.apply_pezesha_loan(dialog, customer, pos_profile);
        },
        secondary_action_label: __("Close"),
        secondary_action: () => dialog.hide()
      });
      dialog.show();
      dialog.set_message(__("Checking loan offer..."));
      frappe.call({
        method: "vf_pos_customizations.vf_pos_customizations.doctype.pezesha_settings.pezesha_settings.pezesha_loan_offer",
        args: { customer, pos_profile },
        callback: (r) => {
          if (r.message && r.message.data) {
            const offer = r.message.data;
            let html = `<div>${__("Loan Offer Available")}<br>`;
            html += `${__("Max Amount")}: ${frappe.format(offer.amount, { fieldtype: "Currency" })}<br>`;
            html += `${__("Interest")}: ${offer.interest_rate || offer.interest || ""}%<br>`;
            html += `${__("Term")}: ${offer.duration || offer.term || ""} days</div>`;
            dialog.set_value("offer_html", html);
            dialog.set_primary_action(__("Apply for Loan"), () => {
              dialog.set_primary_action(__("Applying..."), null, true);
              this.apply_pezesha_loan(dialog, customer, pos_profile, offer);
            });
          } else if (typeof r.message === "string") {
            dialog.set_value("offer_html", `<div>${r.message}</div>`);
            dialog.set_primary_action(__("Close"), () => dialog.hide());
          } else {
            dialog.set_value("offer_html", `<div>${__("No offer available.")}</div>`);
            dialog.set_primary_action(__("Close"), () => dialog.hide());
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
        rate: offer.rate || "",
        fee: offer.fee || ""
      };
      frappe.call({
        method: "vf_pos_customizations.vf_pos_customizations.doctype.pezesha_settings.pezesha_settings.pezesha_loan_application",
        args: { data: JSON.stringify(data), pos_profile },
        callback: (r) => {
          if (r.message && r.message.status) {
            dialog.set_value("offer_html", `<div>${__("Loan application status")}: ${r.message.status}<br>${r.message.message || ""}</div>`);
          } else {
            dialog.set_value("offer_html", `<div>${__("Loan application failed.")}</div>`);
          }
          dialog.set_primary_action(__("Close"), () => dialog.hide());
        }
      });
    }
    handle_pezesha_status() {
      const doc = this.events.get_frm().doc;
      const customer = doc.customer;
      const pos_profile = doc.pos_profile;
      const dialog = new frappe.ui.Dialog({
        title: __("Pezesha Loan Status"),
        fields: [
          { fieldtype: "HTML", fieldname: "status_html" }
        ],
        primary_action_label: __("Close"),
        primary_action: () => dialog.hide()
      });
      dialog.show();
      dialog.set_message(__("Checking loan status..."));
      frappe.call({
        method: "vf_pos_customizations.vf_pos_customizations.doctype.pezesha_settings.pezesha_settings.pezesha_loan_status",
        args: { customer, pos_profile },
        callback: (r) => {
          if (r.message && r.message.loan_amount) {
            let html = `<div>${__("Loan Amount")}: ${frappe.format(r.message.loan_amount, { fieldtype: "Currency" })}<br>`;
            html += `${__("Status")}: ${r.message.status || ""}<br>`;
            html += `${__("Due Date")}: ${r.message.due_date || ""}</div>`;
            dialog.set_value("status_html", html);
          } else if (typeof r.message === "string") {
            dialog.set_value("status_html", `<div>${r.message}</div>`);
          } else {
            dialog.set_value("status_html", `<div>${__("No loan status available.")}</div>`);
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
            onchange: function() {
            }
          },
          parent: this.$totals_section.find(`.remarks`),
          render_input: true
        });
        this[`remark_control`].set_value("");
      }
    }
    render_payment_mode_dom() {
      const doc = this.events.get_frm().doc;
      const payments = doc.payments;
      const currency = doc.currency;
      this.$payment_modes.html(
        `${payments.map((p, i) => {
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
        }).join("")}`
      );
      payments.forEach((p) => {
        const mode = this.sanitize_mode_of_payment(p.mode_of_payment);
        const me = this;
        this[`${mode}_control`] = frappe.ui.form.make_control({
          df: {
            label: p.mode_of_payment,
            fieldtype: "Currency",
            placeholder: __("Enter {0} amount.", [p.mode_of_payment]),
            onchange: function() {
              const current_value = frappe.model.get_value(p.doctype, p.name, "amount");
              if (current_value != this.value) {
                frappe.model.set_value(p.doctype, p.name, "amount", flt(this.value)).then(() => me.update_totals_section());
                const formatted_currency = format_currency(this.value, currency);
                me.$payment_modes.find(`.${mode}-amount`).html(formatted_currency);
              }
            }
          },
          parent: this.$payment_modes.find(`.${mode}.mode-of-payment-control`),
          render_input: true
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
      const grand_total = cint(frappe.sys_defaults.disable_rounded_total) ? doc.grand_total : doc.rounded_total;
      const currency = doc.currency;
      const shortcuts = this.get_cash_shortcuts(flt(grand_total));
      this.$payment_modes.find(".cash-shortcuts").remove();
      let shortcuts_html = shortcuts.map((s) => {
        return `<div class="shortcut" data-value="${s}">${format_currency(s, currency)}</div>`;
      }).join("");
      this.$payment_modes.find('[data-payment-type="Cash"]').find(".mode-of-payment-control").after(`<div class="cash-shortcuts">${shortcuts_html}</div>`);
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
      if (!loyalty_program)
        return;
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
          onchange: async function() {
            if (!loyalty_points)
              return;
            if (this.value > max_redeemable_amount) {
              frappe.show_alert({
                message: __("You cannot redeem more than {0}.", [
                  format_currency(max_redeemable_amount)
                ]),
                indicator: "red"
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
          description
        },
        parent: this.$payment_modes.find(`.loyalty-amount.mode-of-payment-control`),
        render_input: true
      });
      this["loyalty-amount_control"].toggle_label(false);
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
      if (!doc)
        doc = this.events.get_frm().doc;
      const paid_amount = doc.paid_amount;
      const grand_total = cint(frappe.sys_defaults.disable_rounded_total) ? doc.grand_total : doc.rounded_total;
      const remaining = grand_total - doc.paid_amount;
      const change = doc.change_amount || remaining <= 0 ? -1 * remaining : void 0;
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
      return mode_of_payment.replace(/ +/g, "_").replace(/[^\p{L}\p{N}_-]/gu, "").replace(/^[^_a-zA-Z\p{L}]+/u, "").toLowerCase();
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
            indicator: "orange"
          });
          frappe.utils.play_sound("error");
        }
      }
      return validation_flag;
    }
  };

  // ../vf_pos_customizations/vf_pos_customizations/public/js/pos_controller.js
  frappe.provide("erpnext.PointOfSale");
  erpnext.PointOfSale.Controller = class {
    constructor(wrapper) {
      this.wrapper = $(wrapper).find(".layout-main-section");
      this.page = wrapper.page;
      this.check_opening_entry();
    }
    fetch_opening_entry() {
      return frappe.call("erpnext.selling.page.point_of_sale.point_of_sale.check_opening_entry", {
        user: frappe.session.user
      });
    }
    check_opening_entry() {
      this.fetch_opening_entry().then((r) => {
        if (r.message.length) {
          this.prepare_app_defaults(r.message[0]);
        } else {
          this.create_opening_voucher();
        }
      });
    }
    create_opening_voucher() {
      const me = this;
      const table_fields = [
        {
          fieldname: "mode_of_payment",
          fieldtype: "Link",
          in_list_view: 1,
          label: __("Mode of Payment"),
          options: "Mode of Payment",
          reqd: 1
        },
        {
          fieldname: "opening_amount",
          fieldtype: "Currency",
          in_list_view: 1,
          label: __("Opening Amount"),
          options: "company:company_currency",
          onchange: function() {
            dialog.fields_dict.balance_details.df.data.some((d) => {
              if (d.idx == this.doc.idx) {
                d.opening_amount = this.value;
                dialog.fields_dict.balance_details.grid.refresh();
                return true;
              }
            });
          }
        }
      ];
      const fetch_pos_payment_methods = () => {
        const pos_profile = dialog.fields_dict.pos_profile.get_value();
        if (!pos_profile)
          return;
        frappe.db.get_doc("POS Profile", pos_profile).then(({ payments }) => {
          dialog.fields_dict.balance_details.df.data = [];
          payments.forEach((pay) => {
            const { mode_of_payment } = pay;
            dialog.fields_dict.balance_details.df.data.push({ mode_of_payment, opening_amount: "0" });
          });
          dialog.fields_dict.balance_details.grid.refresh();
        });
      };
      const dialog = new frappe.ui.Dialog({
        title: __("Create POS Opening Entry"),
        static: true,
        fields: [
          {
            fieldtype: "Link",
            label: __("Company"),
            default: frappe.defaults.get_default("company"),
            options: "Company",
            fieldname: "company",
            reqd: 1
          },
          {
            fieldtype: "Link",
            label: __("POS Profile"),
            options: "POS Profile",
            fieldname: "pos_profile",
            reqd: 1,
            get_query: () => pos_profile_query(),
            onchange: () => fetch_pos_payment_methods()
          },
          {
            fieldname: "balance_details",
            fieldtype: "Table",
            label: __("Opening Balance Details"),
            cannot_add_rows: false,
            in_place_edit: true,
            reqd: 1,
            data: [],
            fields: table_fields
          }
        ],
        primary_action: async function({ company, pos_profile, balance_details }) {
          if (!balance_details.length) {
            frappe.show_alert({
              message: __("Please add Mode of payments and opening balance details."),
              indicator: "red"
            });
            return frappe.utils.play_sound("error");
          }
          balance_details = balance_details.filter((d) => d.mode_of_payment);
          const method = "erpnext.selling.page.point_of_sale.point_of_sale.create_opening_voucher";
          const res = await frappe.call({
            method,
            args: { pos_profile, company, balance_details },
            freeze: true
          });
          !res.exc && me.prepare_app_defaults(res.message);
          dialog.hide();
        },
        primary_action_label: __("Submit")
      });
      dialog.show();
      const pos_profile_query = () => {
        return {
          query: "erpnext.accounts.doctype.pos_profile.pos_profile.pos_profile_query",
          filters: { company: dialog.fields_dict.company.get_value() }
        };
      };
    }
    async prepare_app_defaults(data) {
      this.pos_opening = data.name;
      this.company = data.company;
      this.pos_profile = data.pos_profile;
      this.pos_opening_time = data.period_start_date;
      this.item_stock_map = {};
      this.settings = {};
      frappe.db.get_value("Stock Settings", void 0, "allow_negative_stock").then(({ message }) => {
        this.allow_negative_stock = flt(message.allow_negative_stock) || false;
      });
      frappe.call({
        method: "erpnext.selling.page.point_of_sale.point_of_sale.get_pos_profile_data",
        args: { pos_profile: this.pos_profile },
        callback: (res) => {
          const profile = res.message;
          Object.assign(this.settings, profile);
          this.settings.customer_groups = profile.customer_groups.map((group) => group.name);
          this.make_app();
        }
      });
      frappe.realtime.on(`poe_${this.pos_opening}_closed`, (data2) => {
        const route = frappe.get_route_str();
        if (data2 && route == "point-of-sale") {
          frappe.dom.freeze();
          frappe.msgprint({
            title: __("POS Closed"),
            indicator: "orange",
            message: __("POS has been closed at {0}. Please refresh the page.", [
              frappe.datetime.str_to_user(data2.creation).bold()
            ]),
            primary_action_label: __("Refresh"),
            primary_action: {
              action() {
                window.location.reload();
              }
            }
          });
        }
      });
    }
    set_opening_entry_status() {
      this.page.set_title_sub(
        `<span class="indicator orange">
				<a class="text-muted" href="#Form/POS%20Opening%20Entry/${this.pos_opening}">
					Opened at ${frappe.datetime.str_to_user(this.pos_opening_time)}
				</a>
			</span>`
      );
    }
    make_app() {
      this.prepare_dom();
      this.prepare_components();
      this.prepare_menu();
      this.prepare_fullscreen_btn();
      this.make_new_invoice();
      this.prepare_vf_button();
    }
    prepare_vf_button() {
      this.page.add_button(__("New Invoice"), () => this.new_invoice(), {
        btn_class: "btn-default new-invoice-btn"
      });
      this.page.add_button(__("Payment Reconciliation"), () => frappe.set_route("pos-payments"), {
        btn_class: "btn-default payment-recon-btn"
      });
    }
    prepare_dom() {
      this.wrapper.append(`<div class="point-of-sale-app"></div>`);
      this.$components_wrapper = this.wrapper.find(".point-of-sale-app");
    }
    prepare_components() {
      this.init_item_selector();
      this.init_item_details();
      this.init_item_cart();
      this.init_payments();
      this.init_recent_order_list();
      this.init_order_summary();
    }
    prepare_menu() {
      this.page.clear_menu();
      this.page.add_menu_item(__("Open Form View"), this.open_form_view.bind(this), false, "Ctrl+F");
      this.page.add_menu_item(
        __("Toggle Recent Orders"),
        this.toggle_recent_order.bind(this),
        false,
        "Ctrl+O"
      );
      this.page.add_menu_item(__("Save as Draft"), this.save_draft_invoice.bind(this), false, "Ctrl+S");
      this.page.add_menu_item(__("Close the POS"), this.close_pos.bind(this), false, "Shift+Ctrl+C");
    }
    prepare_fullscreen_btn() {
      this.page.page_actions.find(".custom-actions").empty();
      this.page.add_button(__("Full Screen"), null, { btn_class: "btn-default fullscreen-btn" });
      this.bind_fullscreen_events();
    }
    bind_fullscreen_events() {
      this.$fullscreen_btn = this.page.page_actions.find(".fullscreen-btn");
      this.$fullscreen_btn.on("click", function() {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen();
        } else if (document.exitFullscreen) {
          document.exitFullscreen();
        }
      });
      $(document).on("fullscreenchange", this.handle_fullscreen_change_event.bind(this));
    }
    handle_fullscreen_change_event() {
      let enable_fullscreen_label = __("Full Screen");
      let exit_fullscreen_label = __("Exit Full Screen");
      if (document.fullscreenElement) {
        this.$fullscreen_btn[0].innerText = exit_fullscreen_label;
      } else {
        this.$fullscreen_btn[0].innerText = enable_fullscreen_label;
      }
    }
    open_form_view() {
      frappe.model.sync(this.frm.doc);
      frappe.set_route("Form", this.frm.doc.doctype, this.frm.doc.name);
    }
    toggle_recent_order() {
      const show = this.recent_order_list.$component.is(":hidden");
      this.toggle_recent_order_list(show);
    }
    save_draft_invoice() {
      if (!this.$components_wrapper.is(":visible"))
        return;
      if (this.frm.doc.items.length == 0) {
        frappe.show_alert({
          message: __("You must add atleast one item to save it as draft."),
          indicator: "red"
        });
        frappe.utils.play_sound("error");
        return;
      }
      this.frm.save(void 0, void 0, void 0, () => {
        frappe.show_alert({
          message: __("There was an error saving the document."),
          indicator: "red"
        });
        frappe.utils.play_sound("error");
      }).then(() => {
        frappe.run_serially([
          () => frappe.dom.freeze(),
          () => this.make_new_invoice(),
          () => frappe.dom.unfreeze()
        ]);
      });
    }
    close_pos() {
      if (!this.$components_wrapper.is(":visible"))
        return;
      let voucher = frappe.model.get_new_doc("POS Closing Entry");
      voucher.pos_profile = this.frm.doc.pos_profile;
      voucher.user = frappe.session.user;
      voucher.company = this.frm.doc.company;
      voucher.pos_opening_entry = this.pos_opening;
      voucher.period_end_date = frappe.datetime.now_datetime();
      voucher.posting_date = frappe.datetime.now_date();
      voucher.posting_time = frappe.datetime.now_time();
      frappe.set_route("Form", "POS Closing Entry", voucher.name);
    }
    init_item_selector() {
      this.item_selector = new erpnext.PointOfSale.ItemSelector({
        wrapper: this.$components_wrapper,
        pos_profile: this.pos_profile,
        settings: this.settings,
        events: {
          item_selected: (args) => this.on_cart_update(args),
          get_frm: () => this.frm || {}
        }
      });
    }
    init_item_cart() {
      this.cart = new erpnext.PointOfSale.ItemCart({
        wrapper: this.$components_wrapper,
        settings: this.settings,
        events: {
          get_frm: () => this.frm,
          cart_item_clicked: (item) => {
            const item_row = this.get_item_from_frm(item);
            this.item_details.toggle_item_details_section(item_row);
          },
          numpad_event: (value, action) => this.update_item_field(value, action),
          checkout: () => this.save_and_checkout(),
          edit_cart: () => this.payment.edit_cart(),
          customer_details_updated: (details) => {
            this.item_selector.load_items_data();
            this.customer_details = details;
            this.payment.render_loyalty_points_payment_mode();
          }
        }
      });
    }
    init_item_details() {
      this.item_details = new erpnext.PointOfSale.ItemDetails({
        wrapper: this.$components_wrapper,
        settings: this.settings,
        events: {
          get_frm: () => this.frm,
          toggle_item_selector: (minimize) => {
            this.item_selector.resize_selector(minimize);
            this.cart.toggle_numpad(minimize);
          },
          form_updated: (item, field, value) => {
            const item_row = frappe.model.get_doc(item.doctype, item.name);
            if (item_row && item_row[field] != value) {
              const args = {
                field,
                value,
                item: this.item_details.current_item
              };
              return this.on_cart_update(args);
            }
            return Promise.resolve();
          },
          highlight_cart_item: (item) => {
            const cart_item = this.cart.get_cart_item(item);
            this.cart.toggle_item_highlight(cart_item);
          },
          item_field_focused: (fieldname) => {
            this.cart.toggle_numpad_field_edit(fieldname);
          },
          set_value_in_current_cart_item: (selector, value) => {
            this.cart.update_selector_value_in_cart_item(
              selector,
              value,
              this.item_details.current_item
            );
          },
          clone_new_batch_item_in_frm: (batch_serial_map, item) => {
            Object.keys(batch_serial_map).forEach((batch) => {
              const item_to_clone = this.frm.doc.items.find((i) => i.name == item.name);
              const new_row = this.frm.add_child("items", __spreadValues({}, item_to_clone));
              new_row.batch_no = batch;
              new_row.serial_no = batch_serial_map[batch].join(`
`);
              new_row.qty = batch_serial_map[batch].length;
              this.frm.doc.items.forEach((row) => {
                if (item.item_code === row.item_code) {
                  this.update_cart_html(row);
                }
              });
            });
          },
          remove_item_from_cart: () => this.remove_item_from_cart(),
          get_item_stock_map: () => this.item_stock_map,
          close_item_details: () => {
            this.item_details.toggle_item_details_section(null);
            this.cart.prev_action = null;
            this.cart.toggle_item_highlight();
          },
          get_available_stock: (item_code, warehouse) => this.get_available_stock(item_code, warehouse)
        }
      });
    }
    init_payments() {
      this.payment = new erpnext.PointOfSale.Payment({
        wrapper: this.$components_wrapper,
        events: {
          get_frm: () => this.frm || {},
          get_customer_details: () => this.customer_details || {},
          toggle_other_sections: (show) => {
            if (show) {
              this.item_details.$component.is(":visible") ? this.item_details.$component.css("display", "none") : "";
              this.item_selector.toggle_component(false);
            } else {
              this.item_selector.toggle_component(true);
            }
          },
          submit_invoice: () => {
            this.frm.savesubmit().then((r) => {
              this.toggle_components(false);
              this.order_summary.toggle_component(true);
              this.order_summary.load_summary_of(this.frm.doc, true);
              frappe.show_alert({
                indicator: "green",
                message: __("POS invoice {0} created succesfully", [r.doc.name])
              });
            });
          }
        }
      });
    }
    init_recent_order_list() {
      this.recent_order_list = new erpnext.PointOfSale.PastOrderList({
        wrapper: this.$components_wrapper,
        events: {
          open_invoice_data: (name) => {
            frappe.db.get_doc("POS Invoice", name).then((doc) => {
              this.order_summary.load_summary_of(doc);
            });
          },
          reset_summary: () => this.order_summary.toggle_summary_placeholder(true)
        }
      });
    }
    init_order_summary() {
      this.order_summary = new erpnext.PointOfSale.PastOrderSummary({
        wrapper: this.$components_wrapper,
        settings: this.settings,
        events: {
          get_frm: () => this.frm,
          process_return: (name) => {
            this.recent_order_list.toggle_component(false);
            frappe.db.get_doc("POS Invoice", name).then((doc) => {
              frappe.run_serially([
                () => this.make_return_invoice(doc),
                () => this.cart.load_invoice(),
                () => this.item_selector.toggle_component(true)
              ]);
            });
          },
          edit_order: (name) => {
            this.recent_order_list.toggle_component(false);
            frappe.run_serially([
              () => this.frm.refresh(name),
              () => this.frm.call("reset_mode_of_payments"),
              () => this.cart.load_invoice(),
              () => this.item_selector.toggle_component(true)
            ]);
          },
          delete_order: (name) => {
            frappe.model.delete_doc(this.frm.doc.doctype, name, () => {
              this.recent_order_list.refresh_list();
            });
          },
          new_order: () => {
            frappe.run_serially([
              () => frappe.dom.freeze(),
              () => this.make_new_invoice(),
              () => this.item_selector.toggle_component(true),
              () => frappe.dom.unfreeze()
            ]);
          }
        }
      });
    }
    toggle_recent_order_list(show) {
      this.toggle_components(!show);
      this.recent_order_list.toggle_component(show);
      this.order_summary.toggle_component(show);
    }
    toggle_components(show) {
      this.cart.toggle_component(show);
      this.item_selector.toggle_component(show);
      !show ? this.item_details.toggle_component(false) || this.payment.toggle_component(false) : "";
    }
    make_new_invoice() {
      return frappe.run_serially([
        () => frappe.dom.freeze(),
        () => this.make_sales_invoice_frm(),
        () => this.set_pos_profile_data(),
        () => this.set_pos_profile_status(),
        () => this.cart.reset_customer_selector(),
        () => frappe.dom.unfreeze()
      ]);
    }
    make_sales_invoice_frm() {
      const doctype = "POS Invoice";
      return new Promise((resolve) => {
        if (this.frm) {
          this.frm = this.get_new_frm(this.frm);
          this.frm.doc.items = [];
          this.frm.doc.is_pos = 1;
          resolve();
        } else {
          frappe.model.with_doctype(doctype, () => {
            this.frm = this.get_new_frm();
            this.frm.doc.items = [];
            this.frm.doc.is_pos = 1;
            resolve();
          });
        }
      });
    }
    get_new_frm(_frm) {
      const doctype = "POS Invoice";
      const page = $("<div>");
      const frm = _frm || new frappe.ui.form.Form(doctype, page, false);
      const name = frappe.model.make_new_doc_and_get_name(doctype, true);
      frm.refresh(name);
      return frm;
    }
    async make_return_invoice(doc) {
      frappe.dom.freeze();
      this.frm = this.get_new_frm(this.frm);
      this.frm.doc.items = [];
      return frappe.call({
        method: "erpnext.accounts.doctype.pos_invoice.pos_invoice.make_sales_return",
        args: {
          source_name: doc.name,
          target_doc: this.frm.doc
        },
        callback: (r) => {
          frappe.model.sync(r.message);
          frappe.get_doc(r.message.doctype, r.message.name).__run_link_triggers = false;
          this.set_pos_profile_data().then(() => {
            frappe.dom.unfreeze();
          });
        }
      });
    }
    set_pos_profile_data() {
      if (this.company && !this.frm.doc.company)
        this.frm.doc.company = this.company;
      if ((this.pos_profile && !this.frm.doc.pos_profile) | (this.frm.doc.is_return && this.pos_profile != this.frm.doc.pos_profile)) {
        this.frm.doc.pos_profile = this.pos_profile;
      }
      this.frm.doc.set_warehouse = this.settings.warehouse;
      if (!this.frm.doc.company)
        return;
      return this.frm.trigger("set_pos_data");
    }
    set_pos_profile_status() {
      this.page.set_indicator(this.pos_profile, "blue");
    }
    async on_cart_update(args) {
      frappe.dom.freeze();
      let item_row = void 0;
      try {
        let { field, value, item } = args;
        item_row = this.get_item_from_frm(item);
        const item_row_exists = !$.isEmptyObject(item_row);
        const from_selector = field === "qty" && value === "+1";
        if (from_selector)
          value = flt(item_row.qty) + flt(value);
        if (item_row_exists) {
          if (field === "qty")
            value = flt(value);
          if (["qty", "conversion_factor"].includes(field) && value > 0 && !this.allow_negative_stock) {
            const qty_needed = field === "qty" ? value * item_row.conversion_factor : item_row.qty * value;
            await this.check_stock_availability(item_row, qty_needed, this.frm.doc.set_warehouse);
          }
          if (this.is_current_item_being_edited(item_row) || from_selector) {
            await frappe.model.set_value(item_row.doctype, item_row.name, field, value);
            if (item.serial_no && from_selector) {
              await frappe.model.set_value(
                item_row.doctype,
                item_row.name,
                "serial_no",
                item_row.serial_no + `
${item.serial_no}`
              );
            }
            this.update_cart_html(item_row);
          }
        } else {
          if (!this.frm.doc.customer)
            return this.raise_customer_selection_alert();
          const { item_code, batch_no, serial_no, rate, uom, stock_uom } = item;
          if (!item_code)
            return;
          if (rate == void 0 || rate == 0) {
            frappe.show_alert({
              message: __("Price is not set for the item."),
              indicator: "orange"
            });
            frappe.utils.play_sound("error");
            return;
          }
          const new_item = { item_code, batch_no, rate, uom, [field]: value, stock_uom };
          if (serial_no) {
            await this.check_serial_no_availablilty(item_code, this.frm.doc.set_warehouse, serial_no);
            new_item["serial_no"] = serial_no;
          }
          new_item["use_serial_batch_fields"] = 1;
          new_item["warehouse"] = this.settings.warehouse;
          if (field === "serial_no")
            new_item["qty"] = value.split(`
`).length || 0;
          item_row = this.frm.add_child("items", new_item);
          if (field === "qty" && value !== 0 && !this.allow_negative_stock) {
            const qty_needed = value * item_row.conversion_factor;
            await this.check_stock_availability(item_row, qty_needed, this.frm.doc.set_warehouse);
          }
          await this.trigger_new_item_events(item_row);
          this.update_cart_html(item_row);
          if (this.item_details.$component.is(":visible"))
            this.edit_item_details_of(item_row);
          if (this.check_serial_batch_selection_needed(item_row) && !this.item_details.$component.is(":visible"))
            this.edit_item_details_of(item_row);
        }
      } catch (error) {
        console.log(error);
      } finally {
        frappe.dom.unfreeze();
        return item_row;
      }
    }
    raise_customer_selection_alert() {
      frappe.dom.unfreeze();
      frappe.show_alert({
        message: __("You must select a customer before adding an item."),
        indicator: "orange"
      });
      frappe.utils.play_sound("error");
    }
    get_item_from_frm({ name, item_code, batch_no, uom, rate }) {
      let item_row = null;
      if (name) {
        item_row = this.frm.doc.items.find((i) => i.name == name);
      } else {
        const has_batch_no = batch_no !== "null" && batch_no !== null;
        item_row = this.frm.doc.items.find(
          (i) => i.item_code === item_code && (!has_batch_no || has_batch_no && i.batch_no === batch_no) && i.uom === uom && i.price_list_rate === flt(rate)
        );
      }
      return item_row || {};
    }
    edit_item_details_of(item_row) {
      this.item_details.toggle_item_details_section(item_row);
    }
    is_current_item_being_edited(item_row) {
      return item_row.name == this.item_details.current_item.name;
    }
    update_cart_html(item_row, remove_item) {
      this.cart.update_item_html(item_row, remove_item);
      this.cart.update_totals_section(this.frm);
    }
    check_serial_batch_selection_needed(item_row) {
      const serialized = item_row.has_serial_no;
      const batched = item_row.has_batch_no;
      const no_serial_selected = !item_row.serial_no;
      const no_batch_selected = !item_row.batch_no;
      if (serialized && no_serial_selected || batched && no_batch_selected || serialized && batched && (no_batch_selected || no_serial_selected)) {
        return true;
      }
      return false;
    }
    async trigger_new_item_events(item_row) {
      await this.frm.script_manager.trigger("item_code", item_row.doctype, item_row.name);
      await this.frm.script_manager.trigger("qty", item_row.doctype, item_row.name);
    }
    async check_stock_availability(item_row, qty_needed, warehouse) {
      const resp = (await this.get_available_stock(item_row.item_code, warehouse)).message;
      const available_qty = resp[0];
      const is_stock_item = resp[1];
      frappe.dom.unfreeze();
      const bold_uom = item_row.stock_uom.bold();
      const bold_item_code = item_row.item_code.bold();
      const bold_warehouse = warehouse.bold();
      const bold_available_qty = available_qty.toString().bold();
      if (!(available_qty > 0)) {
        if (is_stock_item) {
          frappe.model.clear_doc(item_row.doctype, item_row.name);
          frappe.throw({
            title: __("Not Available"),
            message: __("Item Code: {0} is not available under warehouse {1}.", [
              bold_item_code,
              bold_warehouse
            ])
          });
        } else {
          return;
        }
      } else if (is_stock_item && available_qty < qty_needed) {
        frappe.throw({
          message: __(
            "Stock quantity not enough for Item Code: {0} under warehouse {1}. Available quantity {2} {3}.",
            [bold_item_code, bold_warehouse, bold_available_qty, bold_uom]
          ),
          indicator: "orange"
        });
        frappe.utils.play_sound("error");
      }
      frappe.dom.freeze();
    }
    async check_serial_no_availablilty(item_code, warehouse, serial_no) {
      const method = "erpnext.stock.doctype.serial_no.serial_no.get_pos_reserved_serial_nos";
      const args = { filters: { item_code, warehouse } };
      const res = await frappe.call({ method, args });
      if (res.message.includes(serial_no)) {
        frappe.throw({
          title: __("Not Available"),
          message: __("Serial No: {0} has already been transacted into another POS Invoice.", [
            serial_no.bold()
          ])
        });
      }
    }
    get_available_stock(item_code, warehouse) {
      const me = this;
      return frappe.call({
        method: "erpnext.accounts.doctype.pos_invoice.pos_invoice.get_stock_availability",
        args: {
          item_code,
          warehouse
        },
        callback(res) {
          if (!me.item_stock_map[item_code])
            me.item_stock_map[item_code] = {};
          me.item_stock_map[item_code][warehouse] = res.message;
        }
      });
    }
    update_item_field(value, field_or_action) {
      if (field_or_action === "checkout") {
        this.item_details.toggle_item_details_section(null);
      } else if (field_or_action === "remove") {
        this.remove_item_from_cart();
      } else {
        const field_control = this.item_details[`${field_or_action}_control`];
        if (!field_control)
          return;
        field_control.set_focus();
        value != "" && field_control.set_value(value);
      }
    }
    remove_item_from_cart() {
      frappe.dom.freeze();
      const { doctype, name, current_item } = this.item_details;
      return frappe.model.set_value(doctype, name, "qty", 0).then(() => {
        frappe.model.clear_doc(doctype, name);
        this.update_cart_html(current_item, true);
        this.item_details.toggle_item_details_section(null);
        frappe.dom.unfreeze();
      }).catch((e) => console.log(e));
    }
    async save_and_checkout() {
      if (this.frm.is_dirty()) {
        let save_error = false;
        await this.frm.save(null, null, null, () => save_error = true);
        !save_error && this.payment.checkout();
        save_error && setTimeout(() => {
          this.cart.toggle_checkout_btn(true);
        }, 300);
      } else {
        this.payment.checkout();
      }
    }
  };
})();
//# sourceMappingURL=vf_pos_customizations.bundle.BJ6OVTKL.js.map
