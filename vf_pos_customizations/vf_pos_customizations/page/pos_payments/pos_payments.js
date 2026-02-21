frappe.pages["pos-payments"].on_page_load = function (wrapper) {
    //add breadcrumb next to title that navigates to pos-payments
    frappe.breadcrumbs.add("POS", "point-of-sale");
    frappe.ui.make_app_page({
        parent: wrapper,
        title: __("Payment Reconciliation"),
        single_column: true,
    });

    const html = `
    <div class="row" style="margin-top: 24px;">
        <div class="col-md-8 col-12 pb-2 pr-0">
            <div class="card p-4" style="min-height: 80vh;">
                <div class="form-group mb-2">
                    <div class="d-flex align-items-center">
                        <div id="pr-customer-section" class="mr-2" style="flex: 1 1 auto;"></div>
                        <button class="btn" style="background: #00BDF0; color: #fff;" id="pr-search-invoices">Search</button>
                    </div>
                    <hr />
                    <div id="pr-invoices-section">
                        <h5><strong>Invoices</strong> <span class="text-primary" id="pr-total-outstanding"></span></h5>
                        <div id="pr-invoices-table" class="mb-3"></div>
                    </div>
                </div>
                <hr/>
                <div id="pr-mpesa-section">
                    <h5><strong>Search Mpesa Payments</strong></h5>
                    <div class="form-row mb-2">
                        <div class="col-md-4 col-12">
                            <input type="text" class="form-control" id="pr-mpesa-name" placeholder="Search by Name" />
                        </div>
                        <div class="col-md-3 col-12">
                            <button class="btn" style="background: #00BDF0; color: #fff;" id="pr-search-mpesa">Search</button>
                        </div>
                    </div>
                    <div id="pr-mpesa-table" class="mb-3"></div>
                </div>
            </div>
        </div>
        <div class="col-md-4 col-12 pb-3">
            <div class="card p-4" style="min-height: 80vh;">
                <div class="form-group mb-2">
                    <label for="pr-current-pos-profile"><strong>POS Profile</strong></label>
                    <input type="text" class="form-control" id="pr-current-pos-profile" readonly />
                </div>
                <hr />
                <h4 class="text-primary">Totals</h4>
                <div id="pr-totals-section"></div>
                <hr/>
                <div class="form-group">
                    <label><strong>Difference:</strong></label>
                    <input type="text" class="form-control text-right" id="pr-difference" readonly />
                </div>
                <div class="pt-4">
                    <button class="btn btn-primary btn-block" id="pr-submit">Submit</button>
                </div>
            </div>
        </div>
    </div>`;

    $(wrapper).find(".layout-main-section").html(html);

    // State
    let pos_profile = null;
    let pos_opening_shift = null;
    let company = null;
    let payment_methods = [];
    let outstanding_invoices = [];
    let unallocated_payments = [];
    let mpesa_payments = [];
    let selected_invoices = [];
    let selected_payments = [];
    let selected_mpesa_payments = [];
    let payment_methods_list = [];
    let pos_profiles_list = [];
    let pos_profile_search = "";
    let customer_name = "";
    let customer_info = {};
    let mpesa_search_name = "";
    let mpesa_search_mobile = "";

    // Move control creation after HTML is rendered
    $(document).ready(function () {
        window.pr_customer_control = frappe.ui.form.make_control({
            df: {
                fieldtype: "Link",
                options: "Customer",
                label: __("Customer"),
                fieldname: "customer_link",
                placeholder: __("Select Customer"),
                change: function () {
                    customer_name = this.get_value();
                    $("#pr-customer-section").val(customer_name);

                    frappe.db.get_value("Customer", customer_name, "customer_name").then(r => {
                        mpesa_search_name = r.message.customer_name || "";
                        get_outstanding_invoices();
                        get_draft_mpesa_payments_register();
                    });
                }
            },
            parent: $("#pr-customer-section"),
            render_input: true,
        });
    });

    function flt(val) {
        return parseFloat(val) || 0;
    }
    function currencySymbol(currency) {
        return currency ? (frappe.defaults.get_default("currency_symbol") || currency + " ") : "";
    }
    function formtCurrency(val) {
        return flt(val).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    }

    //Pagination variables
    let invoice_page = 1;
    let mpesa_page = 1;
    const PAGE_SIZE = 25;

    //Renderers
    function renderInvoicesTable() {
        let start = (invoice_page - 1) * PAGE_SIZE;
        let end = start + PAGE_SIZE;
        let paged_invoices = outstanding_invoices.slice(start, end);

        let html = `<table class="table table-bordered table-sm">
            <thead>
                <tr>
                    <th></th>
                    <th>Invoice</th>
                    <th>Customer</th>
                    <th>Date</th>
                    <th>Due Date</th>
                    <th>Total</th>
                    <th>Outstanding</th>
                </tr>
            </thead>
            <tbody>`;
        paged_invoices.forEach((inv, idx) => {
            html += `<tr>
                <td><input type="checkbox" class="pr-invoice-select" data-idx="${start + idx}" ${selected_invoices.includes(inv) ? "checked" : ""}></td>
                <td>${inv.name}</td>
                <td>${inv.customer_name}</td>
                <td>${inv.posting_date}</td>
                <td>${inv.due_date}</td>
                <td>${currencySymbol(inv.currency)}${formtCurrency(inv.grand_total)}</td>
                <td class="text-primary">${currencySymbol(inv.currency)}${formtCurrency(inv.outstanding_amount)}</td>
            </tr>`;
        });
        html += `</tbody></table>`;

        // Pagination controls
        let total_pages = Math.ceil(outstanding_invoices.length / PAGE_SIZE);
        let html_pagination = `<nav>
            <ul class="pagination justify-content-center">`;

        function pageItem(page, label = null, active = false, disabled = false) {
            return `<li class="page-item${active ? " active" : ""}${disabled ? " disabled" : ""}">
                <a class="page-link pr-invoice-page" data-page="${page}" href="#">${label || page}</a>
            </li>`;
        }

        if (total_pages > 1) {
            html_pagination += pageItem(1, "1", invoice_page === 1);
            if (invoice_page > 4) {
                html_pagination += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
            }
            let start = Math.max(2, invoice_page - 2);
            let end = Math.min(total_pages - 1, invoice_page + 2);
            for (let i = start; i <= end; i++) {
                html_pagination += pageItem(i, null, invoice_page === i);
            }
            if (invoice_page < total_pages - 3) {
                html_pagination += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
            }
            if (total_pages > 1) {
                html_pagination += pageItem(total_pages, total_pages.toString(), invoice_page === total_pages);
            }
        }

        html_pagination += `</ul></nav>`;
        html += html_pagination;

        $("#pr-invoices-table").html(html);
    }

    function renderMpesaTable() {
        let start = (mpesa_page - 1) * PAGE_SIZE;
        let end = start + PAGE_SIZE;
        let paged_mpesa = mpesa_payments.slice(start, end);

        let html = `<table class="table table-bordered table-sm">
            <thead>
                <tr>
                    <th></th>
                    <th>Payment ID</th>
                    <th>Full Name</th>
                    <th>Date</th>
                    <th>Amount</th>
                </tr>
            </thead>
            <tbody>`;
        paged_mpesa.forEach((mp, idx) => {
            html += `<tr>
                <td><input type="checkbox" class="pr-mpesa-select" data-idx="${start + idx}" ${selected_mpesa_payments.includes(mp) ? "checked" : ""}></td>
                <td>${mp.transid}</td>
                <td>${mp.full_name}</td>
                <td>${mp.posting_date}</td>
                <td class="text-primary">${currencySymbol(mp.currency)}${formtCurrency(mp.amount)}</td>
            </tr>`;
        });
        html += `</tbody></table>`;

        // Pagination controls
        let total_pages = Math.ceil(mpesa_payments.length / PAGE_SIZE);
        let html_pagination = `<nav><ul class="pagination justify-content-center">`;

        function mpesaPageItem(page, label = null, active = false, disabled = false) {
            return `<li class="page-item${active ? " active" : ""}${disabled ? " disabled" : ""}">
                <a class="page-link pr-mpesa-page" data-page="${page}" href="#">${label || page}</a>
            </li>`;
        }

        if (total_pages > 1) {
            html_pagination += mpesaPageItem(1, "1", mpesa_page === 1);
            if (mpesa_page > 4) {
                html_pagination += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
            }
            let range_start = Math.max(2, mpesa_page - 2);
            let range_end = Math.min(total_pages - 1, mpesa_page + 2);
            for (let i = range_start; i <= range_end; i++) {
                html_pagination += mpesaPageItem(i, null, mpesa_page === i);
            }
            if (mpesa_page < total_pages - 3) {
                html_pagination += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
            }
            html_pagination += mpesaPageItem(total_pages, total_pages.toString(), mpesa_page === total_pages);
        }

        html_pagination += `</ul></nav>`;
        html += html_pagination;

        $("#pr-mpesa-table").html(html);
    }


    function renderTotalsSection() {
        let total_selected_invoices = selected_invoices.reduce((acc, cur) => acc + flt(cur.outstanding_amount), 0);
        let total_selected_mpesa_payments = selected_mpesa_payments.reduce((acc, cur) => acc + flt(cur.amount), 0);
        let total_payment_methods = payment_methods.reduce((acc, cur) => acc + flt(cur.amount), 0);
        let diff = flt(total_selected_invoices - total_selected_mpesa_payments - total_payment_methods);

        let html = `
            <div class="form-group">
                <label>Total Invoices:</label>
                <input type="text" class="form-control text-right" value="${formtCurrency(total_selected_invoices)}" readonly />
            </div>
            <div class="form-group">
                <label>Total Mpesa:</label>
                <input type="text" class="form-control text-right" value="${formtCurrency(total_selected_mpesa_payments)}" readonly />
            </div>
        `;
        $("#pr-totals-section").html(html);
        $("#pr-difference").val(formtCurrency(diff));
    }

	function check_opening_entry() {
        fetch_opening_entry().then((r) => {
            if (r.message.length) {
                prepare_app_defaults(r.message[0]);
                set_payment_methods();
                get_outstanding_invoices();
                get_draft_mpesa_payments_register();
                // Set POS Profile field
                $("#pr-current-pos-profile").val(r.message[0].pos_profile || "");

                //Handle submit of payment reconciliation
                $(document).on("click", "#pr-submit", function () {
                    if (!customer_name) {
                        frappe.throw(__("Please select a customer"));
                        return;
                    }
                    let total_selected_invoices = selected_invoices.reduce((acc, cur) => acc + flt(cur.outstanding_amount), 0);
                    let total_selected_mpesa_payments = selected_mpesa_payments.reduce((acc, cur) => acc + flt(cur.amount), 0);
                    let total_payment_methods = payment_methods.reduce((acc, cur) => acc + flt(cur.amount), 0);

                    if (total_selected_mpesa_payments == 0 && total_payment_methods == 0) {
                        frappe.throw(__("Please make a payment or select a payment"));
                        return;
                    }
                    if (total_selected_mpesa_payments > 0 && selected_invoices.length == 0) {
                        frappe.throw(__("Please select an invoice"));
                        return;
                    }

                    let payload = {
                        customer: customer_name,
                        company: r.message[0].company,
                        currency: "KES",
                        payment_methods: payment_methods,
                        selected_invoices: selected_invoices,
                        selected_mpesa_payments: selected_mpesa_payments,
                        total_selected_invoices: flt(total_selected_invoices),
                        total_selected_mpesa_payments: flt(total_selected_mpesa_payments),
                        total_payment_methods: flt(total_payment_methods),
                    };
                    console.log("Payload to be sent:", payload);

                    frappe.call({
                        method: "vf_pos_customizations.api.payment_entry.process_pos_payment",
                        args: { payload },
                        freeze: true,
                        freeze_message: __("Processing Payment"),
                        callback: function (r) {
                            if (r.message) {
                                frappe.utils.play_sound("submit");
                                selected_invoices = [];
                                selected_mpesa_payments = [];
                                set_payment_methods();
                                get_outstanding_invoices();
                                get_draft_mpesa_payments_register();
                                frappe.msgprint(__("Payment processed successfully!"));
                            }
                        },
                    });
                });
            } else {
                //redirect to page point-of-sale
                frappe.set_route("point-of-sale");
                frappe.msgprint({
                    title: __("No Opening Entry Found"),
                    message: __("Please create a POS Opening Entry before proceeding."),
                    indicator: "red",
                }); 
            }
        });
    }

    function fetch_opening_entry() {
		return frappe.call("erpnext.selling.page.point_of_sale.point_of_sale.check_opening_entry", {
			user: frappe.session.user,
		});
    }

    async function prepare_app_defaults(data) {
		this.pos_opening = data.name;
		this.company = data.company;
		this.pos_profile = data.pos_profile;
		this.pos_opening_time = data.period_start_date;
		this.item_stock_map = {};
		this.settings = {};

		frappe.db.get_value("Stock Settings", undefined, "allow_negative_stock").then(({ message }) => {
			this.allow_negative_stock = flt(message.allow_negative_stock) || false;
		});

		frappe.call({
			method: "erpnext.selling.page.point_of_sale.point_of_sale.get_pos_profile_data",
			args: { pos_profile: this.pos_profile },
			callback: (res) => {
				const profile = res.message;
				Object.assign(this.settings, profile);
				this.settings.customer_groups = profile.customer_groups.map((group) => group.name);
			},
		});

		frappe.realtime.on(`poe_${this.pos_opening}_closed`, (data) => {
			const route = frappe.get_route_str();
			if (data && route == "point-of-sale") {
				frappe.dom.freeze();
				frappe.msgprint({
					title: __("POS Closed"),
					indicator: "orange",
					message: __("POS has been closed at {0}. Please refresh the page.", [
						frappe.datetime.str_to_user(data.creation).bold(),
					]),
					primary_action_label: __("Refresh"),
					primary_action: {
						action() {
							window.location.reload();
						},
					},s
				});
			}
		});
	}


    function get_outstanding_invoices() {
        invoice_page = 1;
        fetch_opening_entry().then((r) => {
            if (r.message.length) {
                prepare_app_defaults(r.message[0]);
                frappe.call("vf_pos_customizations.api.payment_entry.get_outstanding_invoices", {
                    customer: customer_name,
                    company: r.message[0].company,
                    currency: "KES",
                    pos_profile: r.message[0].pos_profile,
                }).then(r => {
                    outstanding_invoices = r.message || [];
                    renderInvoicesTable();
                    updateTotals();
                });
            }else
            {
                frappe.msgprint({
                    title: __("No Opening Entry Found"),
                    message: __("Please create a POS Opening Entry before proceeding."),
                    indicator: "red",
                });
            }
        });
    }

    function get_draft_mpesa_payments_register() {
        mpesa_page = 1;
        frappe.call("vf_pos_customizations.api.m_pesa.get_mpesa_draft_payments", {
            company: "Victory Farms Ltd",
            mode_of_payment: null,
            full_name: mpesa_search_name || null,
            mobile_no: mpesa_search_mobile || null,
            payment_methods_list: payment_methods_list,
        }).then(r => {
            mpesa_payments = r.message || [];
            renderMpesaTable();
            updateTotals();
        });
    }

    function set_payment_methods() {
        payment_methods = [];
         fetch_opening_entry().then((r) => {
            if (r.message.length) {
                prepare_app_defaults(r.message[0]);
            if (!r.message[0].pos_profile) return;
            frappe.db.get_doc("POS Profile", r.message[0].pos_profile).then(doc => {
                if (!doc.payments) return;
                doc.payments.forEach(method => {
                    payment_methods.push({
                        mode_of_payment: method.mode_of_payment,
                        amount: 0,
                        row_id: method.name,
                    });
                });
                payment_methods_list = doc.payments.map(m => m.mode_of_payment);
                get_draft_mpesa_payments_register();
            });
        }
        else {
                frappe.msgprint({
                    title: __("No Opening Entry Found"),
                    message: __("Please create a POS Opening Entry before proceeding."),
                    indicator: "red",
                });
            }
        });
    }

    function updateTotals() {
        renderTotalsSection();
    }

    //Pagination event handlers
    $(document).on("click", ".pr-invoice-page", function (e) {
        e.preventDefault();
        invoice_page = parseInt($(this).data("page"));
        renderInvoicesTable();
    });
    $(document).on("click", ".pr-mpesa-page", function (e) {
        e.preventDefault();
        mpesa_page = parseInt($(this).data("page"));
        renderMpesaTable();
    });

    //Filter by the customer when an invoice is selected, 
    $(document).on("change", ".pr-invoice-select", function () {
        let idx = $(this).data("idx");
        let invoice = outstanding_invoices[idx];
        if ($(this).is(":checked")) {
            if (!selected_invoices.includes(invoice)) selected_invoices.push(invoice);
            if (window.pr_customer_control && window.pr_customer_control.set_value) {
                window.pr_customer_control.set_value(invoice.customer);
                customer_name = invoice.customer;
                frappe.db.get_doc("Customer", customer_name).then(customer_doc => {
                    let first_name = customer_doc.customer_name.split(" ")[0];
                    $("#pr-mpesa-name").val(first_name);

                });
            } else {
                $("#pr-customer-section input").val(invoice.customer);
            }

            get_outstanding_invoices();
            get_draft_mpesa_payments_register();
        } else {
            selected_invoices = selected_invoices.filter(i => i !== invoice);
            updateTotals();
        }
    });

    //Event Handlers
    $(document).on("click", "#pr-search-invoices", function () {
        customer_name = "";
        console.log("Searching invoices for customer:", customer_name);
        get_outstanding_invoices();
    });

    $(document).on("click", "#pr-search-mpesa", function () {
        mpesa_search_name = $("#pr-mpesa-name").val();
        get_draft_mpesa_payments_register();
    });

    $(document).on("change", ".pr-invoice-select", function () {
        let idx = $(this).data("idx");
        let invoice = outstanding_invoices[idx];
        if ($(this).is(":checked")) {
            if (!selected_invoices.includes(invoice)) selected_invoices.push(invoice);
        } else {
            selected_invoices = selected_invoices.filter(i => i !== invoice);
        }
        updateTotals();
    });

    $(document).on("change", ".pr-mpesa-select", function () {
        let idx = $(this).data("idx");
        let mpesa = mpesa_payments[idx];
        if ($(this).is(":checked")) {
            if (!selected_mpesa_payments.includes(mpesa)) selected_mpesa_payments.push(mpesa);
        } else {
            selected_mpesa_payments = selected_mpesa_payments.filter(i => i !== mpesa);
        }
        updateTotals();
    });

    $(document).on("input", ".pr-payment-method", function () {
        let idx = $(this).data("idx");
        let val = flt($(this).val());
        payment_methods[idx].amount = val;
        updateTotals();
    });

   
    //auto-search on enter or empty for all search fields
    $(document).off("keydown", "#pr-customer-section, #pr-mpesa-name")
        .on("keydown", "#pr-customer-section, #pr-mpesa-name", function (e) {
            if (e.key === "Enter") {
                if (this.id === "pr-customer-section") {
                    customer_name = $(this).val();
                    get_outstanding_invoices();
                }
                if (this.id === "pr-mpesa-name") {
                    mpesa_search_name = $("#pr-mpesa-name").val();
                    get_draft_mpesa_payments_register();
                }
            }
        });

    $(document).off("input", "#pr-customer-section, #pr-mpesa-name")
        .on("input", "#pr-customer-section, #pr-mpesa-name", function () {
            if ($(this).val() === "") {
                if (this.id === "pr-customer-section") {
                    customer_name = "";
                    get_outstanding_invoices();
                }
                if (this.id === "pr-mpesa-name") {
                    mpesa_search_name = $("#pr-mpesa-name").val();
                    get_draft_mpesa_payments_register();
                }
            }
        });

    //to ensure opening entry is checked
    check_opening_entry();
};