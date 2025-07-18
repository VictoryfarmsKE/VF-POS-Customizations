// Optimized pos-payments.js
frappe.pages["pos-payments"].on_page_load = function (wrapper) {
    frappe.ui.make_app_page({
        parent: wrapper,
        title: __("Payment Reconciliation"),
        single_column: true,
    });

    const html = `
    <div class="row" style="margin-top: 24px;">
      <div class="col-md-8 col-12 pb-2 pr-0">
        <div class="card p-4" style="min-height: 80vh;">
          <div id="pr-customer-section"></div>
          <hr/>
          <div id="pr-invoices-section">
            <h5><strong>Invoices</strong> <span class="text-primary" id="pr-total-outstanding"></span></h5>
            <div class="form-row mb-2">
              <div class="col-md-4 col-12">
                <input type="text" class="form-control" id="pr-customer-search" placeholder="Search Customer" autocomplete="off" />
              </div>
              <div class="col-md-3 col-12">
                <button class="btn" style="background: #00BDF0; color: #fff;" id="pr-search-invoices">Search</button>
              </div>
            </div>
            <div id="pr-invoices-table" class="mb-3">[Invoices Table]</div>
          </div>
          <hr/>
          <div id="pr-mpesa-section">
            <h5><strong>Search Mpesa Payments</strong></h5>
            <div class="form-row mb-2">
              <div class="col-md-4 col-12">
                <input type="text" class="form-control" id="pr-mpesa-name" placeholder="Search by Name" />
              </div>
              <div class="col-md-4 col-12">
                <input type="text" class="form-control" id="pr-mpesa-mobile" placeholder="Search by Mobile" />
              </div>
              <div class="col-md-3 col-12">
                <button class="btn" style="background: #00BDF0; color: #fff;" id="pr-search-mpesa">Search</button>
              </div>
            </div>
            <div id="pr-mpesa-table" class="mb-3">[Mpesa Payments Table]</div>
          </div>
        </div>
      </div>
      <div class="col-md-4 col-12 pb-3">
        <div class="card p-4" style="min-height: 80vh;">
          <h4 class="text-primary">Totals</h4>
          <div id="pr-totals-section">[Totals Fields]</div>
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

       const state = {
        customer: null,
        customer_info: {},
        invoices: [],
        selected_invoices: [],
        unallocated_payments: [],
        selected_payments: [],
        mpesa_payments: [],
        selected_mpesa: [],
        payment_methods: [
            { mode_of_payment: 'Cash', amount: 0 },
            { mode_of_payment: 'Mpesa', amount: 0 }
        ],
        company: frappe.defaults.get_default('company'),
        currency: frappe.defaults.get_default('currency'),
        pos_profile: null,
    };

    const format_currency_value = (val) => {
        const html = frappe.format(val, { fieldtype: 'Currency', options: state.currency });
        return $('<div>').html(html).text();
    };

    const calculate_total = (items, field) => items.reduce((acc, cur) => acc + (parseFloat(cur[field]) || 0), 0);

    const update_totals = () => {
        const total_selected_invoices = calculate_total(state.selected_invoices, 'outstanding_amount');
        const total_selected_payments = calculate_total(state.selected_payments, 'unallocated_amount');
        const total_selected_mpesa = calculate_total(state.selected_mpesa, 'amount');
        const total_payment_methods = calculate_total(state.payment_methods, 'amount');
        const diff = total_selected_invoices - total_selected_payments - total_selected_mpesa - total_payment_methods;

        $('#pr-total-outstanding').text(`- Total Outstanding: ${format_currency_value(calculate_total(state.invoices, 'outstanding_amount'))}`);
        $('#pr-total-unallocated').text(`- Total Unallocated: ${format_currency_value(calculate_total(state.unallocated_payments, 'unallocated_amount'))}`);

        $('#pr-totals-section').html(`
            <div class="form-group row">
                <label class="col-md-7">Total Invoices:</label>
                <div class="col-md-5">
                    <input class="form-control text-right" value="${format_currency_value(total_selected_invoices)}" readonly/>
                </div>
            </div>
            <div class="form-group row">
                <label class="col-md-7">Total Payments:</label>
                <div class="col-md-5">
                    <input class="form-control text-right" value="${format_currency_value(total_selected_payments)}" readonly/>
                </div>
            </div>
            <div class="form-group row">
                <label class="col-md-7">Total Mpesa:</label>
                <div class="col-md-5">
                    <input class="form-control text-right" value="${format_currency_value(total_selected_mpesa)}" readonly/>
                </div>
            </div>
        `);

        $('#pr-difference').val(format_currency_value(diff));
    };


    // --- 1. Customer Search (autocomplete) ---
	frappe.require([
    "assets/frappe/js/lib/jquery/jquery-ui.min.js",
    "assets/frappe/css/jquery-ui.min.css"
	], function() {
		// Only run this after jQuery UI is loaded
		$('#pr-customer-search').autocomplete({
			source: function(request, response) {
				frappe.call({
					method: 'frappe.desk.search.search_link',
					args: {
						doctype: 'Customer',
						txt: request.term,
						filters: {},
					},
					callback: function(r) {
						response((r.message || []).map(x => x.value));
					}
				});
			},
			minLength: 2,
			select: function(event, ui) {
				state.customer = ui.item.value;
				load_customer_info_and_data();
			}
		});

		$('#pr-search-invoices').on('click', function () {
			state.customer = $('#pr-customer-search').val();
			load_customer_info_and_data();
		});
	});

    

    // --- 2. Load customer info, invoices, payments, payment methods ---
    function load_customer_info_and_data() {
        if (!state.customer) return;
        frappe.call({
            method: 'frappe.client.get',
            args: { doctype: 'Customer', name: state.customer },
            callback: function(r) {
                state.customer_info = r.message || {};
                // Optionally show customer info
                $('#pr-customer-section').html('<b>Customer:</b> ' + frappe.utils.escape_html(state.customer));
            }
        });
        // Fetch company, currency, pos_profile (stub: use default or fetch from backend if needed)
        state.company = frappe.defaults.get_default('company');
        state.currency = frappe.defaults.get_default('currency');
        // Fetch invoices
        frappe.call({
            method: 'vf_pos_customizations.vf_pos_customizations.api.payment_entry.get_outstanding_invoices',
            args: {
                customer: state.customer,
                company: state.company,
                currency: state.currency,
                pos_profile_name: null 
            },
            callback: function(r) {
                state.invoices = r.message || [];
                state.selected_invoices = [];
                render_invoices_table();
                update_totals();
            }
        });
        // Fetch unallocated payments
        frappe.call({
            method: 'vf_pos_customizations.vf_pos_customizations.api.payment_entry.get_unallocated_payments',
            args: {
                customer: state.customer,
                company: state.company,
                currency: state.currency,
            },
            callback: function(r) {
                state.unallocated_payments = r.message || [];
                state.selected_payments = [];
                render_unallocated_table();
                update_totals();
            }
        });
        // Fetch payment methods (stub: static for now)
        state.payment_methods = [
            { mode_of_payment: 'Cash', amount: 0 },
            { mode_of_payment: 'Mpesa', amount: 0 }
        ];
        render_payment_methods();
        // Fetch Mpesa payments (empty by default)
        state.mpesa_payments = [];
        state.selected_mpesa = [];
        render_mpesa_table();
    }

    // --- 3. Render Invoices Table ---
    function render_invoices_table() {
        let html = '<table class="table table-bordered table-sm"><thead><tr>' +
            '<th></th><th>Invoice</th><th>Customer</th><th>Date</th><th>Due Date</th><th>Total</th><th>Outstanding</th></tr></thead><tbody>';
        state.invoices.forEach((inv, idx) => {
            html += `<tr>
                <td><input type="checkbox" class="pr-invoice-select" data-idx="${idx}" ${state.selected_invoices.includes(inv) ? 'checked' : ''}></td>
                <td>${frappe.utils.escape_html(inv.name)}</td>
                <td>${frappe.utils.escape_html(inv.customer_name || '')}</td>
                <td>${frappe.utils.escape_html(inv.posting_date || '')}</td>
                <td>${frappe.utils.escape_html(inv.due_date || '')}</td>
                <td>${frappe.format(inv.grand_total, {fieldtype:'Currency', options:state.currency})}</td>
                <td>${frappe.format(inv.outstanding_amount, {fieldtype:'Currency', options:state.currency})}</td>
            </tr>`;
        });
        html += '</tbody></table>';
        $('#pr-invoices-table').html(html);
        // Checkbox event
        $('.pr-invoice-select').on('change', function() {
            const idx = $(this).data('idx');
            const inv = state.invoices[idx];
            if ($(this).is(':checked')) {
                if (!state.selected_invoices.includes(inv)) state.selected_invoices.push(inv);
            } else {
                state.selected_invoices = state.selected_invoices.filter(x => x !== inv);
            }
            update_totals();
        });
    }

    // --- 4. Render Unallocated Payments Table ---
    function render_unallocated_table() {
        let html = '<table class="table table-bordered table-sm"><thead><tr>' +
            '<th></th><th>Payment ID</th><th>Customer</th><th>Date</th><th>Mode</th><th>Paid</th><th>Unallocated</th></tr></thead><tbody>';
        state.unallocated_payments.forEach((pay, idx) => {
            html += `<tr>
                <td><input type="checkbox" class="pr-payment-select" data-idx="${idx}" ${state.selected_payments.includes(pay) ? 'checked' : ''}></td>
                <td>${frappe.utils.escape_html(pay.name)}</td>
                <td>${frappe.utils.escape_html(pay.customer_name || '')}</td>
                <td>${frappe.utils.escape_html(pay.posting_date || '')}</td>
                <td>${frappe.utils.escape_html(pay.mode_of_payment || '')}</td>
                <td>${frappe.format(pay.paid_amount, {fieldtype:'Currency', options:state.currency})}</td>
                <td>${frappe.format(pay.unallocated_amount, {fieldtype:'Currency', options:state.currency})}</td>
            </tr>`;
        });
        html += '</tbody></table>';
        $('#pr-unallocated-table').html(html);
        // Checkbox event
        $('.pr-payment-select').on('change', function() {
            const idx = $(this).data('idx');
            const pay = state.unallocated_payments[idx];
            if ($(this).is(':checked')) {
                if (!state.selected_payments.includes(pay)) state.selected_payments.push(pay);
            } else {
                state.selected_payments = state.selected_payments.filter(x => x !== pay);
            }
            update_totals();
        });
    }

    // --- 5. Render Mpesa Payments Table ---
    function render_mpesa_table() {
        let html = '<table class="table table-bordered table-sm"><thead><tr>' +
            '<th></th><th>Payment ID</th><th>Full Name</th><th>Mobile Number</th><th>Date</th><th>Amount</th></tr></thead><tbody>';
        state.mpesa_payments.forEach((mp, idx) => {
            html += `<tr>
                <td><input type="checkbox" class="pr-mpesa-select" data-idx="${idx}" ${state.selected_mpesa.includes(mp) ? 'checked' : ''}></td>
                <td>${frappe.utils.escape_html(mp.transid || mp.name)}</td>
                <td>${frappe.utils.escape_html(mp.full_name || '')}</td>
                <td>${frappe.utils.escape_html(mp.mobile_no || '')}</td>
                <td>${frappe.utils.escape_html(mp.posting_date || '')}</td>
                <td>${frappe.format(mp.amount, {fieldtype:'Currency', options:state.currency})}</td>
            </tr>`;
        });
        html += '</tbody></table>';
        $('#pr-mpesa-table').html(html);
        // Checkbox event
        $('.pr-mpesa-select').on('change', function() {
            const idx = $(this).data('idx');
            const mp = state.mpesa_payments[idx];
            if ($(this).is(':checked')) {
                if (!state.selected_mpesa.includes(mp)) state.selected_mpesa.push(mp);
            } else {
                state.selected_mpesa = state.selected_mpesa.filter(x => x !== mp);
            }
            update_totals();
        });
    }

    // --- 6. Mpesa Search ---
    $('#pr-search-mpesa').on('click', function() {
        const name = $('#pr-mpesa-name').val();
        const mobile = $('#pr-mpesa-mobile').val();
        frappe.call({
            method: 'vf_pos_customizations.vf_pos_customizations.api.m_pesa.get_mpesa_draft_payments',
            args: {
                company: state.company,
                mode_of_payment: null,
                full_name: name || null,
                mobile_no: mobile || null,
                payment_methods_list: state.payment_methods.map(x => x.mode_of_payment),
            },
            callback: function(r) {
                state.mpesa_payments = r.message || [];
                state.selected_mpesa = [];
                render_mpesa_table();
                update_totals();
            }
        });
    });

    // --- 7. Render Payment Methods ---
    function render_payment_methods() {
        let html = '';
        state.payment_methods.forEach((pm, idx) => {
            html += `<div class="form-group row">
                <label class="col-md-7 col-form-label">${frappe.utils.escape_html(pm.mode_of_payment)}:</label>
                <div class="col-md-5">
                    <input type="number" min="0" step="0.01" class="form-control pr-payment-method-amount" data-idx="${idx}" value="${pm.amount || 0}" />
                </div>
            </div>`;
        });
        $('#pr-payment-methods').html(html);
        $('.pr-payment-method-amount').on('input', function() {
            const idx = $(this).data('idx');
            const val = parseFloat($(this).val()) || 0;
            state.payment_methods[idx].amount = val;
            update_totals();
        });
    }

    // --- 9. Submit Logic ---
    $('#pr-submit').on('click', function() {
        if (!state.customer) {
            frappe.throw(__('Please select a customer'));
            return;
        }
        if (state.selected_payments.length === 0 && state.selected_mpesa.length === 0 && state.payment_methods.every(x => !x.amount)) {
            frappe.throw(__('Please make a payment or select a payment'));
            return;
        }
        if (state.selected_payments.length > 0 && state.selected_invoices.length === 0) {
            frappe.throw(__('Please select an invoice'));
            return;
        }
        // Prepare payload
        const payload = {
            customer: state.customer,
            company: state.company,
            currency: state.currency,
            pos_profile_name: state.pos_profile,
            payment_methods: state.payment_methods,
            selected_invoices: state.selected_invoices,
            selected_payments: state.selected_payments,
            selected_mpesa_payments: state.selected_mpesa,
            total_selected_invoices: state.selected_invoices.reduce((acc, cur) => acc + (parseFloat(cur.outstanding_amount) || 0), 0),
            total_selected_payments: state.selected_payments.reduce((acc, cur) => acc + (parseFloat(cur.unallocated_amount) || 0), 0),
            total_selected_mpesa_payments: state.selected_mpesa.reduce((acc, cur) => acc + (parseFloat(cur.amount) || 0), 0),
            total_payment_methods: state.payment_methods.reduce((acc, cur) => acc + (parseFloat(cur.amount) || 0), 0),
        };
        frappe.call({
            method: 'vf_pos_customizations.vf_pos_customizations.api.payment_entry.process_pos_payment',
            args: { payload },
            freeze: true,
            freeze_message: __('Processing Payment'),
            callback: function(r) {
                if (r.message) {
                    frappe.show_alert({message: __('Payment processed successfully!'), indicator: 'green'});
                    // Reset state/UI
                    $('#pr-customer-search').val('');
                    state = {
                        customer: null,
                        customer_info: {},
                        invoices: [],
                        selected_invoices: [],
                        unallocated_payments: [],
                        selected_payments: [],
                        mpesa_payments: [],
                        selected_mpesa: [],
                        payment_methods: state.payment_methods.map(x => ({...x, amount: 0})),
                        payment_method_amounts: {},
                        company: state.company,
                        currency: state.currency,
                        pos_profile: state.pos_profile,
                    };
                    render_invoices_table();
                    render_unallocated_table();
                    render_mpesa_table();
                    render_payment_methods();
                    update_totals();
                }
            }
        });
    });

    // Initial render
    render_invoices_table();
    render_unallocated_table();
    render_mpesa_table();
    render_payment_methods();
    update_totals();
}; 