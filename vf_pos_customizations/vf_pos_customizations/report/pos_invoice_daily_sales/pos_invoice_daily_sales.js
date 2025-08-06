// Copyright (c) 2025, Christine Kanga and contributors
// For license information, please see license.txt

frappe.query_reports["POS Invoice Daily Sales"] = {
	filters: [
		{
		fieldname: "company",
		label: __("Company"),
		fieldtype: "Link",
		options: "Company",
		default: frappe.defaults.get_user_default("Company"),
		reqd: 1,
		},
		{
		fieldname: "from_date",
		label: __("From Date"),
		fieldtype: "Date",
		default: frappe.datetime.get_today(),
		reqd: 1,
		},
		{
		fieldname: "to_date",
		label: __("To Date"),
		fieldtype: "Date",
		default: frappe.datetime.get_today(),
		reqd: 1,
		},
		{
		fieldname: "item_group",
		label: "Item Group",
		fieldtype: "Link",
		options: "Item Group",
		reqd: 0,
		},
		{
		fieldname: "value_or_quantity",
		label: __("Value/Quantity"),
		fieldtype: "Select",
		options: ["Value", "Quantity"],
		default: "Value",
		reqd: 1,
		},
		{
		fieldname: "view_type_option",
		label: __("View type option"),
		fieldtype: "Select",
		options: ["Summary", "Range", "Compare"],
		default: "Summary",
		reqd: 1,
		},
		{
		fieldname: "warehouse",
		label: __("Warehouse"),
		fieldtype: "Link",
		options: "Warehouse",
		reqd: 0,
		},
  ],
};
