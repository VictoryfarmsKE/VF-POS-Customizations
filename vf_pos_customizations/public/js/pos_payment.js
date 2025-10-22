frappe.after_ajax(() => {
    let retries = 0;
    const interval = setInterval(() => {
        const Payment = erpnext?.PointOfSale?.Payment;
        if (Payment && !Payment.prototype.__pezesha_customized) {
            console.log("Overriding POS Payment with complete Pezesha integration...");
            Payment.prototype.__pezesha_customized = true;
            
            Payment.prototype.pezesha_data = {
                dialognotSuccessful: false,
                dialogSuccessful: false,
                dialogVisible: false,
                dialogtitle: "",
                dialogMessage: "",
                success: true,
                message: "Thank you for your Loan Approval.",
                formLoan: {
                    loan_amount: null,
                    loan_id: null,
                    loan_status: null
                },
                formData: {
                    pezesha_customer_id: "",
                    pezesha_channel_id: "",
                    amount: 0,
                    // base risk-based rate for the first 7 days (percent)
                    rate: 3.5,
                    interest: 0,
                    fee: 0,
                    duration: 0
                },
                // Map of options keyed by duration (e.g., 7, 14)
                loanOptionsByDuration: {},
                // Convenience pointer to the currently selected option
                selectedOption: null
            };

            Payment.prototype.openDialog = function() {
                
                frappe.call({
                    method: "vf_pos_customizations.vf_pos_customizations.doctype.pezesha_settings.pezesha_settings.pezesha_loan_offer",
                    args: {
                        customer: this.customer,
                        pos_profile: this.pos_profile
                    },
                    callback: (r) => {
                        frappe.hide_progress();
                        
                        if (r.message) {
                            // Check if response is a status code (error)
                            if (typeof r.message === 'number') {
                                this.handleLoanOfferError({ status: r.message });
                                return;
                            }
                            
                            // Check if response is an error message
                            if (typeof r.message === 'string' && r.message.includes('pending loan')) {
                                frappe.msgprint({
                                    title: __('Pending Loan'),
                                    message: __(r.message),
                                    indicator: 'yellow'
                                });
                                return;
                            }
                            
                            // Success response - API returns direct data object
                            const responseData = r.message;
                            
                            if (responseData.status === 200 && responseData.data) {
                                const dt = responseData.data;

                                // Normalize options: API may return a single object (7-day) or an array (7 and 14 days)
                                const optionsArray = Array.isArray(dt) ? dt : [dt];

                                // Build map keyed by duration for quick access
                                const byDuration = {};
                                optionsArray.forEach(opt => {
                                    if (!opt) return;
                                    const dur = Number(opt.duration) || 0;
                                    if (!dur) return;
                                    byDuration[dur] = {
                                        duration: dur,
                                        // max amount eligible for this borrower/product
                                        max_amount: Number(opt.amount) || 0,
                                        fee: Number(opt.fee) || 0,
                                        // risk-based base rate for the first 7 days
                                        available_rate: Number(opt.rate) || 3.5
                                    };
                                });

                                this.pezesha_data.loanOptionsByDuration = byDuration;

                                // Set form data for customer/channel
                                this.pezesha_data.formData.pezesha_customer_id = this.customer;
                                this.pezesha_data.formData.pezesha_channel_id = this.pos_profile;

                                // Pick a sensible default option (prefer 7-day if present)
                                this.pezesha_data.selectedOption = byDuration[7] || byDuration[14] || null;
                                if (this.pezesha_data.selectedOption) {
                                    this.pezesha_data.formData.fee = this.pezesha_data.selectedOption.fee;
                                    this.pezesha_data.formData.duration = this.pezesha_data.selectedOption.duration;
                                    this.pezesha_data.formData.rate = this.pezesha_data.selectedOption.available_rate || 3.5;
                                }

                                this.showLoanDialog();
                            } else {
                                this.handleLoanOfferError(responseData);
                            }
                        } else {
                            this.handleLoanOfferError({ status: 404 });
                        }
                    },
                    error: (err) => {
                        frappe.hide_progress();
                        frappe.msgprint({
                            title: __('Connection Error'),
                            message: __('Failed to connect to Pezesha service. Please try again.'),
                            indicator: 'red'
                        });
                        console.error('Pezesha loan offer error:', err);
                    }
                });
            };

            Payment.prototype.handleLoanOfferError = function(response) {
                let dialogtitle = "";
                let dialogMessage = "";
                
                if (response.status == 400 || response == 400) {
                    dialogtitle = "Invalid Request";
                    dialogMessage = "Loan offer request failed: Invalid customer or channel information.";
                } else if (response.status == 404 || response == 404) {
                    dialogtitle = "Borrower not found";
                    dialogMessage = "Unable to find borrower information. Please ensure customer is registered with Pezesha.";
                } else if (response.status == 401 || response == 401) {
                    dialogtitle = "Authorization Error";
                    dialogMessage = "Invalid API credentials. Please check Pezesha settings.";
                } else {
                    dialogtitle = "Pezesha Response";
                    dialogMessage = response.message || "Unable to retrieve loan offers. Please try again later.";

                   }
                
                this.pezesha_data.dialogtitle = dialogtitle;
                this.pezesha_data.dialogMessage = dialogMessage;
                console.log(response.message);
                this.showErrorDialog();
            };

            Payment.prototype.showLoanDialog = function() {
                const formData = this.pezesha_data.formData;
                const loanOptionsByDuration = this.pezesha_data.loanOptionsByDuration || {};
                // risk-based base rate for first 7 days falls back to 3.5 if not provided
                const defaultBaseRate = (this.pezesha_data.selectedOption && this.pezesha_data.selectedOption.available_rate) || 3.5;

                // helper to get option by duration with graceful fallback
                const getOption = (dur) => loanOptionsByDuration[dur] || null;
                const option7 = getOption(7);
                const option14 = getOption(14);

                // Calculation helpers
                const MIN_14_DAY_AMOUNT = 50000;
                const MAX_14_DAY_AMOUNT = 200000; // mirrors existing merchant cap

                const calculateInterest = (amount, duration, baseRatePercent) => {
                    const baseInterest = (amount * (baseRatePercent || 0)) / 100;
                    if (duration === 14) {
                        const incrementalPerDay = 0.0032; // 0.32%
                        const days_8_to_14 = 7; // full 14-day tenure
                        const incrementalInterest = amount * incrementalPerDay * days_8_to_14;
                        return baseInterest + incrementalInterest;
                    }
                    return baseInterest; // 7-day
                };

                const dialog = new frappe.ui.Dialog({
                    title: __('Pezesha Loan Application'),
                    fields: [
                        {
                            fieldtype: 'Currency',
                            fieldname: 'invoice_total',
                            label: __('Invoice Total Amount'),
                            reqd: 1,
                            default: 0,
                            description: __('Enter the total invoice amount for the loan')
                        },
                        {
                            fieldtype: 'Select',
                            fieldname: 'loan_duration',
                            label: __('Loan Duration'),
                            // Initially show only 7-day if available; 14-day will appear once amount >= 50,000 and API option exists
                            options: option7 ? ['7'] : [],
                            default: (option7 ? '7' : ''),
                            depends_on: 'eval: true',
                            description: __('Choose 7 or 14 days (14-day requires at least Ksh 50,000 and eligibility)')
                        },
                        {
                            fieldtype: 'HTML',
                            fieldname: 'loan_summary',
                            options: `
                                <div class="loan-summary">
                                    <div id="loan-calculation-display">
                                        <p class="text-muted">Enter invoice total above to see loan calculations</p>
                                    </div>
                                </div>
                            `
                        }
                    ],
                    primary_action_label: __('Submit Loan Application'),
                    primary_action: () => {
                        const loanAmount = dialog.get_value('invoice_total');
                        const selectedDuration = Number(dialog.get_value('loan_duration')) || 7;
                        const selectedOption = getOption(selectedDuration);
                        if (!loanAmount || loanAmount <= 0) {
                            frappe.msgprint({
                                title: __('Invalid Amount'),
                                message: __('Please enter a valid invoice total amount'),
                                indicator: 'red'
                            });
                            return;
                        }
                        // Must have an eligible option for the selected duration
                        if (!selectedOption) {
                            frappe.msgprint({
                                title: __('No Eligible Product'),
                                message: __('Please enter a valid amount to view eligible loan durations.'),
                                indicator: 'red'
                            });
                            return;
                        }
                        // Enforce 14-day minimum amount and cap
                        if (selectedDuration === 14) {
                            if (loanAmount < MIN_14_DAY_AMOUNT) {
                                frappe.msgprint({
                                    title: __('Amount Below Minimum for 14-day'),
                                    message: __(`Minimum amount for 14-day product is ${format_currency(MIN_14_DAY_AMOUNT)}.`),
                                    indicator: 'red'
                                });
                                return;
                            }
                            if (loanAmount > MAX_14_DAY_AMOUNT) {
                                frappe.msgprint({
                                    title: __('Amount Exceeds 14-day Cap'),
                                    message: __(`Maximum amount for 14-day product is ${format_currency(MAX_14_DAY_AMOUNT)}.`),
                                    indicator: 'red'
                                });
                                return;
                            }
                        }

                        // Check if loan amount exceeds borrower's maximum allowed for selected product
                        if (selectedOption && selectedOption.max_amount && loanAmount > selectedOption.max_amount) {
                            frappe.msgprint({
                                title: __('Loan Amount Exceeds Limit'),
                                message: __(`Invoice total (${format_currency(loanAmount)}) exceeds your maximum loan limit (${format_currency(selectedOption.max_amount)}). Please reduce your order amount.`),
                                indicator: 'red'
                            });
                            return;
                        }
                        const baseRate = (selectedOption && selectedOption.available_rate) || defaultBaseRate;
                        const interestAmount = calculateInterest(loanAmount, selectedDuration, baseRate);
                        this.pezesha_data.formData.amount = loanAmount;
                        this.pezesha_data.formData.interest = interestAmount;
                        this.pezesha_data.formData.rate = baseRate;
                        this.pezesha_data.formData.duration = selectedDuration;
                        // set fee per selected product if available
                        if (selectedOption) {
                            this.pezesha_data.formData.fee = selectedOption.fee || 0;
                        }

                        this.submitForm(dialog, loanAmount, selectedDuration, selectedOption);
                    },
                    secondary_action_label: __('Cancel'),
                    secondary_action: () => {
                        this.closeDialog(dialog);
                    }
                });
                
                // Utility to refresh duration choices based on amount and eligibility
                const refreshDurationOptions = (amount) => {
                    // Determine availability from API response and amount threshold
                    const eligibleFor14 = !!option14 && amount >= MIN_14_DAY_AMOUNT;
                    const eligibleFor7 = !!option7;
                    let options = [];
                    if (eligibleFor7) options.push('7');
                    if (eligibleFor14) options.push('14');

                    const durationField = dialog.get_field('loan_duration');
                    if (durationField) {
                        durationField.df.options = options;
                        // Reset default if current value not in options
                        const current = String(dialog.get_value('loan_duration') || '');
                        const nextDefault = options.includes(current) ? current : (options[0] || '7');
                        durationField.set_value(nextDefault);
                        durationField.refresh();
                    }
                };

                // Common renderer for calculation summary
                const renderSummary = () => {
                    const loanAmount = parseFloat(dialog.get_value('invoice_total')) || 0;
                    const selectedDuration = Number(dialog.get_value('loan_duration')) || 7;
                    const selectedOption = getOption(selectedDuration);
                    const baseRate = (selectedOption && selectedOption.available_rate) || defaultBaseRate;
                    const fee = (selectedOption && selectedOption.fee) || formData.fee || 0;
                    const maxBorrowerAmount = (selectedOption && selectedOption.max_amount) || 0;

                    if (!loanAmount) {
                        $('#loan-calculation-display').html('<p class="text-muted">Enter invoice total above to see loan calculations</p>');
                        return;
                    }

                    if (!selectedOption) {
                        $('#loan-calculation-display').html('<div class="alert alert-info">Enter at least Ksh 50,000 to view the 14-day option, or ensure a 7-day option is available.</div>');
                        return;
                    }

                    const interestAmount = calculateInterest(loanAmount, selectedDuration, baseRate);
                    const totalRepayment = loanAmount + interestAmount + fee;

                    let warnings = '';
                    if (selectedDuration === 14) {
                        if (loanAmount < MIN_14_DAY_AMOUNT) {
                            warnings += `<div class="alert alert-warning"><strong>Warning:</strong> Minimum for 14-day is ${format_currency(MIN_14_DAY_AMOUNT)}</div>`;
                        }
                        if (loanAmount > MAX_14_DAY_AMOUNT) {
                            warnings += `<div class="alert alert-warning"><strong>Warning:</strong> Maximum for 14-day is ${format_currency(MAX_14_DAY_AMOUNT)}</div>`;
                        }
                    }
                    if (maxBorrowerAmount && loanAmount > maxBorrowerAmount) {
                        warnings += `<div class="alert alert-warning"><strong>Warning:</strong> Amount exceeds your loan limit of ${format_currency(maxBorrowerAmount)}</div>`;
                    }

                    const incrementalPerDayPercent = 0.32; // for display
                    const incrementalDays = selectedDuration === 14 ? 7 : 0;
                    const incrementalBlock = selectedDuration === 14
                        ? `<tr><td><strong>Incremental (0.32% x ${incrementalDays} days):</strong></td><td>${format_currency(loanAmount * 0.0032 * incrementalDays)}</td></tr>`
                        : '';

                    $('#loan-calculation-display').html(`
                        ${warnings}
                        <table class="table table-bordered">
                            <tr><td><strong>Duration:</strong></td><td>${selectedDuration} days</td></tr>
                            <tr><td><strong>Maximum Loan Available:</strong></td><td>${format_currency(maxBorrowerAmount)}</td></tr>
                            <tr><td><strong>Loan Amount (Invoice Total):</strong></td><td><strong>${format_currency(loanAmount)}</strong></td></tr>
                            <tr><td><strong>Base Rate (first 7 days):</strong></td><td>${baseRate}%</td></tr>
                            ${incrementalBlock}
                            <tr><td><strong>Interest Amount:</strong></td><td>${format_currency(interestAmount)}</td></tr>
                            <tr><td><strong>Processing Fee:</strong></td><td>${format_currency(fee)}</td></tr>
                            <tr class="table-success"><td><strong>Total Repayment:</strong></td><td><strong>${format_currency(totalRepayment)}</strong></td></tr>
                        </table>
                    `);
                };

                // Add real-time handlers
                dialog.fields_dict.invoice_total.$input.on('input', () => {
                    const loanAmount = parseFloat(dialog.get_value('invoice_total')) || 0;
                    refreshDurationOptions(loanAmount);
                    renderSummary();
                });
                const durationField = dialog.get_field('loan_duration');
                if (durationField && durationField.$input) {
                    durationField.$input.on('change', renderSummary);
                }

                dialog.show();
                this.pezesha_dialog = dialog;
                this.pezesha_data.dialogVisible = true;
                // Initial render
                refreshDurationOptions(parseFloat(dialog.get_value('invoice_total')) || 0);
                renderSummary();
            };

            Payment.prototype.closeDialog = function(dialog) {
                if (dialog) {
                    dialog.hide();
                }
                this.pezesha_data.dialogVisible = false;
            };

            Payment.prototype.submitForm = function(dialog, loanAmount, selectedDuration, selectedOption) {
                if (!loanAmount) {
                    frappe.msgprint({
                        title: __('Invalid Amount'),
                        message: __('Loan amount is required'),
                        indicator: 'red'
                    });
                    return;
                }
                // Validate against selected option's limit if available
                if (selectedOption && selectedOption.max_amount && loanAmount > selectedOption.max_amount) {
                    frappe.msgprint({
                        title: __('Loan Amount Exceeds Limit'),
                        message: __(`Invoice total (${format_currency(loanAmount)}) exceeds your maximum loan limit (${format_currency(selectedOption.max_amount)}).`),
                        indicator: 'red'
                    });
                    return;
                }
                // Enforce 14-day constraints here as well
                const MIN_14_DAY_AMOUNT = 50000;
                const MAX_14_DAY_AMOUNT = 200000;
                if (Number(selectedDuration) === 14) {
                    if (loanAmount < MIN_14_DAY_AMOUNT) {
                        frappe.msgprint({
                            title: __('Amount Below Minimum for 14-day'),
                            message: __(`Minimum amount for 14-day product is ${format_currency(MIN_14_DAY_AMOUNT)}.`),
                            indicator: 'red'
                        });
                        return;
                    }
                    if (loanAmount > MAX_14_DAY_AMOUNT) {
                        frappe.msgprint({
                            title: __('Amount Exceeds 14-day Cap'),
                            message: __(`Maximum amount for 14-day product is ${format_currency(MAX_14_DAY_AMOUNT)}.`),
                            indicator: 'red'
                        });
                        return;
                    }
                }
                
                frappe.call({
                    method: "vf_pos_customizations.vf_pos_customizations.doctype.pezesha_settings.pezesha_settings.pezesha_loan_application",
                    args: {
                        data: JSON.stringify(this.pezesha_data.formData),
                        pos_profile: this.pos_profile
                    },
                    callback: (r) => {

                        if (r.message) {
                            const response = r.message;
                            
                            if (response.status === 200) {
                                this.pezesha_data.message = "Loan application submitted successfully. Awaiting approval.";
                                this.showSuccessDialog();
                            } else {
                                this.handleApplicationError(response);
                            }
                        } else {
                            this.handleApplicationError({ status: 500 });
                        }
                        this.closeDialog(dialog);
                    },
                    error: (err) => {
                        frappe.msgprint({
                            title: __('Error'),
                            message: __('Failed to process loan application'),
                            indicator: 'red'
                        });
                        console.error('Loan application error:', err);
                    }
                });
            };

            Payment.prototype.handleApplicationError = function(response) {
                let dialogtitle = "";
                let dialogMessage = "";
                
                if (response.status === 403 || response.status === 403) {
                    dialogtitle = "Loan Application Denied";
                    dialogMessage = "Loan application failed: You already have a pending loan or previous loan is overdue. Please settle outstanding dues to apply for a new loan.";
                } else if (response.status === 400 || response.status === 400) {
                    dialogtitle = "Invalid Loan Application";
                    dialogMessage = "Loan application failed: The requested loan amount is invalid or exceeds the allowed limit.";
                } else if (response.status === 401 || response.status === 401) {
                    dialogtitle = "Authorization Error";
                    dialogMessage = "Authentication failed. Please check Pezesha API credentials.";
                } else {
                    dialogtitle = "Application Failed";
                    dialogMessage = "Unable to process loan application. Please try again later.";
                }
                
                this.pezesha_data.dialogtitle = dialogtitle;
                this.pezesha_data.dialogMessage = dialogMessage;
                this.showErrorDialog();
            };

            Payment.prototype.showSuccessDialog = function() {
                const dialog = new frappe.ui.Dialog({
                    title: __('Loan Application Submitted'),
                    fields: [
                        {
                            fieldtype: 'HTML',
                            fieldname: 'success_message',
                            options: `
                                <div class="alert alert-success">
                                    <p><i class="fa fa-check-circle"></i> ${this.pezesha_data.message}</p>
                                    <p class="text-muted">You will receive notification once the loan is approved.</p>
                                </div>
                            `
                        }
                    ],
                    primary_action_label: __('Close'),
                    primary_action: () => {
                        this.closeSuccessfulDialog(dialog);
                    }
                });
                
                dialog.show();
                this.pezesha_data.dialogSuccessful = true;
            };

            Payment.prototype.showErrorDialog = function() {
                const dialog = new frappe.ui.Dialog({
                    title: __(this.pezesha_data.dialogtitle),
                    fields: [
                        {
                            fieldtype: 'HTML',
                            fieldname: 'error_message',
                            options: `
                                <div class="alert alert-danger">
                                    <p><i class="fa fa-exclamation-triangle"></i> ${this.pezesha_data.dialogMessage}</p>
                                </div>
                            `
                        }
                    ],
                    primary_action_label: __('Close'),
                    primary_action: () => {
                        this.closeNotSuccessfulDialog(dialog);
                    }
                });
                
                dialog.show();
                this.pezesha_data.dialognotSuccessful = true;
            };

            Payment.prototype.closeSuccessfulDialog = function(dialog) {
                if (dialog) {
                    dialog.hide();
                }
                this.pezesha_data.dialogSuccessful = false;
            };

            Payment.prototype.closeNotSuccessfulDialog = function(dialog) {
                if (dialog) {
                    dialog.hide();
                }
                this.pezesha_data.dialognotSuccessful = false;
            };
            Payment.prototype.pezeshaLoanStatus = function() {
                frappe.call({
                    method: "vf_pos_customizations.vf_pos_customizations.doctype.pezesha_settings.pezesha_settings.pezesha_loan_status",
                    args: {
                        customer: this.customer,
                        pos_profile: this.pos_profile
                    },
                    callback: (r) => {
                        if (r.message) {
                            // Check if response is a status code (error)
                            if (typeof r.message === 'number') {
                                this.handleLoanStatusError();
                                return;
                            }
                        } else {
                            this.handleLoanStatusError();
                        }
                    },
                    error: (err) => {
                        frappe.hide_progress();
                        frappe.msgprint({
                            title: __('Error'),
                            message: __('Failed to retrieve loan status'),
                            indicator: 'red'
                        });
                        console.error('Pezesha status error:', err);
                    }
                });
            };

            Payment.prototype.getStatusColor = function(status) {
                const statusColors = {
                    'approved': 'green',
                    'pending': 'yellow',
                    'rejected': 'red',
                    'disbursed': 'blue',
                    'paid': 'green'
                };
                return statusColors[status?.toLowerCase()] || 'gray';
            };

            Payment.prototype.handleLoanStatusError = function() {
                let dialogtitle = "No Loan Found";
                let dialogMessage = "No active loan found for this customer. Please apply for a loan first.";
                
                this.pezesha_data.dialogtitle = dialogtitle;
                this.pezesha_data.dialogMessage = dialogMessage;
                this.showErrorDialog();
            };

            // Override render_payment_section to add Pezesha UI
            Payment.prototype.render_payment_section = function () {
                console.log("Custom render_payment_section called with complete Pezesha integration");
                
                // Call original methods
                this.render_payment_mode_dom();
                this.make_invoice_fields_control();
                this.update_totals_section();
                
                // Add Pezesha UI elements
                this.render_pezesha_section();

                // Hook phone payment UX enhancements (dialog instead of DOM freeze)
                if (!this._phonePaymentUXHooked) {
                    this._phonePaymentUXHooked = true;
                    // Ensure our listener is set (overrides core behavior with dialog-based UX)
                    try {
                        this.setup_listener_for_payments();
                    } catch (e) {
                        console.warn("Failed to attach custom phone payment listener:", e);
                    }
                }
                // Bind request-for-payment button to show dialog when STK push is initiated
                this._bind_phone_payment_request_button();
            };

            // Render Pezesha section
            Payment.prototype.render_pezesha_section = function() {
                let $parent = this.$invoice_fields_section;
                if (!$parent || !$parent.length) {
                    $parent = $(".invoice_fields_section");
                }
                
                if (!$parent.length) {
                    // Try alternative selectors
                    $parent = $(".payment-container, .pos-payment-section, .invoice-fields");
                }
                
                if ($parent.length) {
                    // Create Pezesha section
                    if ($parent.find('.pezesha-section').length === 0) {
                        $parent.append(`
                            <div class="pezesha-section mt-3" style="padding: 15px; border: 1px solid #e0e0e0; border-radius: 5px;">
                                <h5 style="margin-bottom: 15px; color: #73bf43;"><i class="fa fa-credit-card"></i> Pezesha Loans</h5>
                                <div class="row">
                                    <div class="col-6">
                                        <button class="btn btn-outline-success btn-sm btn-block pezesha-status-btn" 
                                                style="border-color: #73bf43; color: #73bf43; background: #ffff;">
                                            <i class="fa fa-info-circle"></i> ${__("Loan Status")}
                                        </button>
                                    </div>
                                    <div class="col-6">
                                        <button class="btn btn-success btn-sm btn-block pezesha-credit-btn" 
                                                style="background: #73bf43; border-color: #73bf43;">
                                            <i class="fa fa-plus"></i> ${__("Apply for Loan")}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        `);
                        
                        // Add event listeners
                        $parent.find('.pezesha-status-btn').on('click', this.pezeshaLoanStatus.bind(this));
                        $parent.find('.pezesha-credit-btn').on('click', this.openDialog.bind(this));
                    }
                } else {
                    console.warn("No parent found for Pezesha section.");
                }
            };
            clearInterval(interval);
        } else if (retries > 20) {
            clearInterval(interval);
        }
        retries++;
    }, 300);
});