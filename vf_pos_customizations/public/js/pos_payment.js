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
                    rate: 3.5,
                    interest: 0,
                    fee: 0,
                    duration: 0
                },
                loanOptions: {
                    max_amount: 0,
                    fee: 0,
                    duration: 0,
                    available_rate: 0
                }
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
                                
                                // Store loan options/limits for reference
                                this.pezesha_data.loanOptions = {
                                    max_amount: dt.amount,        // Maximum loan amount available
                                    fee: dt.fee,                  // Processing fee
                                    duration: dt.duration,       // Loan duration
                                    available_rate: dt.rate      // Rate from API (but we'll use 3.5%)
                                };
                                
                                // Set form data for customer/channel
                                this.pezesha_data.formData.pezesha_customer_id = this.customer;
                                this.pezesha_data.formData.pezesha_channel_id = this.pos_profile;
                                this.pezesha_data.formData.fee = dt.fee;
                                this.pezesha_data.formData.duration = dt.duration;
                                this.pezesha_data.formData.rate = 3.5; // Fixed 3.5% rate
                                
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
                    dialogtitle = "Service Unavailable";
                    dialogMessage = "Pezesha service is currently unavailable. Please try again later.";
                }
                
                this.pezesha_data.dialogtitle = dialogtitle;
                this.pezesha_data.dialogMessage = dialogMessage;
                this.showErrorDialog();
            };

            Payment.prototype.showLoanDialog = function() {
                const formData = this.pezesha_data.formData;
                const loanOptions = this.pezesha_data.loanOptions;
                const fixedInterestRate = 3.5;
                
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
                        if (!loanAmount || loanAmount <= 0) {
                            frappe.msgprint({
                                title: __('Invalid Amount'),
                                message: __('Please enter a valid invoice total amount'),
                                indicator: 'red'
                            });
                            return;
                        }
                        
                        // Check if loan amount exceeds maximum allowed
                        if (loanAmount > loanOptions.max_amount) {
                            frappe.msgprint({
                                title: __('Loan Amount Exceeds Limit'),
                                message: __(`Invoice total (${format_currency(loanAmount)}) exceeds your maximum loan limit (${format_currency(loanOptions.max_amount)}). Please reduce your order amount.`),
                                indicator: 'red'
                            });
                            return;
                        }
                        
                        const interestAmount = (loanAmount * fixedInterestRate) / 100;
                        this.pezesha_data.formData.amount = loanAmount;
                        this.pezesha_data.formData.interest = interestAmount;
                        this.pezesha_data.formData.rate = fixedInterestRate;
                        
                        this.submitForm(dialog, loanAmount);
                    },
                    secondary_action_label: __('Cancel'),
                    secondary_action: () => {
                        this.closeDialog(dialog);
                    }
                });
                
                // Add real-time calculation update when amount changes
                dialog.fields_dict.invoice_total.$input.on('input', function() {
                    const loanAmount = parseFloat($(this).val()) || 0;
                    if (loanAmount > 0) {
                        const interestAmount = (loanAmount * fixedInterestRate) / 100;
                        const totalRepayment = loanAmount + interestAmount + formData.fee;
                        
                        let maxAmountWarning = '';
                        if (loanAmount > loanOptions.max_amount) {
                            maxAmountWarning = `<div class="alert alert-warning"><strong>Warning:</strong> Amount exceeds your loan limit of ${format_currency(loanOptions.max_amount)}</div>`;
                        }
                        
                        $('#loan-calculation-display').html(`
                            ${maxAmountWarning}
                            <table class="table table-bordered">
                                <tr><td><strong>Maximum Loan Available:</strong></td><td>${format_currency(loanOptions.max_amount)}</td></tr>
                                <tr><td><strong>Loan Amount (Invoice Total):</strong></td><td><strong>${format_currency(loanAmount)}</strong></td></tr>
                                <tr><td><strong>Interest Rate:</strong></td><td>${fixedInterestRate}% (Fixed)</td></tr>
                                <tr><td><strong>Interest Amount:</strong></td><td>${format_currency(interestAmount)}</td></tr>
                                <tr><td><strong>Processing Fee:</strong></td><td>${format_currency(formData.fee)}</td></tr>
                                <tr><td><strong>Loan Duration:</strong></td><td>${loanOptions.duration} days</td></tr>
                                <tr class="table-success"><td><strong>Total Repayment:</strong></td><td><strong>${format_currency(totalRepayment)}</strong></td></tr>
                            </table>
                        `);
                    } else {
                        $('#loan-calculation-display').html('<p class="text-muted">Enter invoice total above to see loan calculations</p>');
                    }
                });
                
                dialog.show();
                this.pezesha_dialog = dialog;
                this.pezesha_data.dialogVisible = true;
            };

            Payment.prototype.closeDialog = function(dialog) {
                if (dialog) {
                    dialog.hide();
                }
                this.pezesha_data.dialogVisible = false;
            };

            Payment.prototype.submitForm = function(dialog, loanAmount) {
                if (!loanAmount) {
                    frappe.msgprint({
                        title: __('Invalid Amount'),
                        message: __('Loan amount is required'),
                        indicator: 'red'
                    });
                    return;
                }
                
                if (loanAmount > this.pezesha_data.loanOptions.max_amount) {
                    frappe.msgprint({
                        title: __('Loan Amount Exceeds Limit'),
                        message: __(`Invoice total (${format_currency(loanAmount)}) exceeds your maximum loan limit (${format_currency(this.pezesha_data.loanOptions.max_amount)}).`),
                        indicator: 'red'
                    });
                    return;
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