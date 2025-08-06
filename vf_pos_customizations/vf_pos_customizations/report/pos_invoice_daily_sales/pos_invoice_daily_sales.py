# Copyright (c) 2025, Christine Kanga and contributors
# For license information, please see license.txt

# import frappe


import frappe
from frappe import _
from frappe.utils import date_diff, add_days, formatdate, get_datetime

def execute(filters=None):
	company = filters.get('company');
	from_date = filters.get('from_date');
	to_date = filters.get('to_date');
	value_or_quantity = filters.get('value_or_quantity');
	view_type_option = filters.get('view_type_option');
	warehouse = filters.get('warehouse');
	status = filters.get('status');
	item_group = filters.get('item_group');

	if from_date > to_date:
		frappe.throw(_('From Date cannot be greater than To Date'));

	def get_columns(from_date, to_date):
		columns = [
			{
				'fieldname': 'warehouse',
				'label': _('Warehouse'),
				'fieldtype': 'Link',
				'options': 'Warehouse',
				'width': '200px'
			},
			{
				'fieldname': 'population_tier',
				'label': _('Population Tier'),
				'fieldtype': 'Data',
				'width': '150px'
			},
			{
				'fieldname': 'item_group',
				'label': _('Item Group'),
				'fieldtype': 'Link',
				'options': 'Item Group',
				'width': '200px'
			},
			{
				'fieldname': 'item',
				'label': _('Items'),
				'fieldtype': 'Link',
				'options': 'Item',
				'width': '200px'
			},
		];

		if view_type_option == 'Summary':
			columns += [
				{
					'fieldname': 'value',
					'label': _('Value'),
					'fieldtype': 'Currency',
					'width': '150px'
				},
				{
					'fieldname': 'quantity',
					'label': _('Quantity'),
					'fieldtype': 'Float',
					'width': '150px'
				}
			];
		elif view_type_option == 'Range':
			fieldtype = 'Currency' if value_or_quantity == 'Value' else 'Float';
			# add one to take care of the zero index when looping below
			num_days = date_diff(to_date, from_date) + 1;

			if num_days > 31:
				frappe.throw('Number of days should not exceed 31');

			for i in range(num_days):
				result_date = get_datetime(add_days(from_date, i));
				columns += [{
					'fieldname': result_date.date(),
					'label': result_date.strftime("%d %b"),
					'fieldtype': fieldtype,
					'width': '200px'
				}];
		else:
			fieldname = value_or_quantity.lower();
			fieldtype = 'Currency' if fieldname == 'value' else 'Float';
			from_date, to_date = get_datetime(from_date), get_datetime(to_date);
			
			columns += [
				{
					'fieldname': from_date.date(),
					'label': from_date.strftime("%d %b"),
					'fieldtype': fieldtype,
					'width': '200px'
				},
				{
					'fieldname': to_date.date(),
					'label': to_date.strftime("%d %b"),
					'fieldtype': fieldtype,
					'width': '200px'
				}
			];

		return columns;

	def get_data():
		data = [];

		conditions = " AND si.docstatus = 1 ";

		if company:
			conditions += f" AND si.company = '{company}'";
		if status:
			conditions += f" AND si.status = '{status}'";

		parent_warehouse = None;
		if warehouse:
			parent_warehouse = frappe.db.get_all('Warehouse', filters = { 'name': warehouse, 'company': company }, fields = [ 'name as warehouse', 'is_group', 'population_tier' ])[0];
			parent_warehouse['indent'] = 0;
			parent_warehouse['parent_warehouse'] = None;
		else:
			parent_warehouse = frappe.db.get_all('Warehouse', filters = { 'warehouse_name': 'All Warehouses', 'company': company }, fields = [ 'name as warehouse', 'is_group', 'population_tier' ])[0];
			parent_warehouse['indent'] = 0;
			parent_warehouse['parent_warehouse'] = None;

		def is_group(warehouse):
			return frappe.db.get_value('Warehouse', warehouse, 'is_group');

		def get_warehouse_tree(warehouse):
			warehouse_list = [ warehouse ];
			final_warehouse_list = [];

			for warehouse in warehouse_list:
				final_warehouse_list.append(warehouse);
				if is_group(warehouse['warehouse']):
					insert_index = warehouse_list.index(warehouse) + 1;
					child_warehouses = frappe.db.get_all('Warehouse', 
						filters = {
							'parent_warehouse': warehouse['warehouse'],
							'warehouse_type': ['not in', ['Transit', 'Spoilage', 'Variance', 'Temporary', 'Return']]
						},
						fields = [ 'name as warehouse', 'is_group', 'parent_warehouse', 'population_tier' ]
					);
					for child_warehouse in child_warehouses:
						child_warehouse['indent'] = warehouse['indent'] + 1;
					warehouse_list[ insert_index:insert_index ] = child_warehouses;
			return final_warehouse_list;

		def get_invoice_list(warehouses, conditions, view_type_option):
			if len(warehouses) > 1:
				_warehouses = tuple(warehouses);
				conditions += f" AND sii.warehouse IN {_warehouses}";
			else:
				conditions += f" AND sii.warehouse = '{warehouses[0]}'";

			if view_type_option == "Compare":
				invoices = frappe.db.sql(f"""
					SELECT si.name as pos_invoice,
						sii.warehouse as source_warehouse
					FROM `tabPOS Invoice` as si
					INNER JOIN `tabPOS Invoice Item` as sii
					ON si.name = sii.parent
					WHERE (si.posting_date = '{from_date}' OR si.posting_date = '{to_date}') {conditions}
				""", as_dict = True);
				return invoices;
			else:
				invoices = frappe.db.sql(f"""
					SELECT si.name as pos_invoice,
						sii.warehouse as source_warehouse
					FROM `tabPOS Invoice` as si
					INNER JOIN `tabPOS Invoice Item` as sii
					ON si.name = sii.parent
					WHERE (si.posting_date BETWEEN '{from_date}' AND '{to_date}') {conditions}
				""", as_dict = True);
				return invoices;

		def get_pos_invoice_item_condition(row, pos_invoice_list):
			sii_condition = " 1 = 1 ";
			invoices_matched_to_warehouse = [x['pos_invoice'] for x in pos_invoice_list if x['source_warehouse'] == row['warehouse']];

			if invoices_matched_to_warehouse:
					if len(invoices_matched_to_warehouse) > 1:
						_invoices_matched_to_warehouse = tuple(invoices_matched_to_warehouse);
						sii_condition += f" AND sii.parent IN {_invoices_matched_to_warehouse}";
					else:
						sii_condition += f" AND sii.parent = '{invoices_matched_to_warehouse[0]}'";

					return sii_condition;
			else:
				return False;


		data = get_warehouse_tree(parent_warehouse);

		warehouses = [x['warehouse'] for x in data];
		pos_invoice_list = get_invoice_list(warehouses, conditions, view_type_option);
		if not pos_invoice_list:
			data = [];

		if view_type_option == 'Summary':
			for item in data:
				sii_condition = get_pos_invoice_item_condition(item, pos_invoice_list);

				if sii_condition:

					if item_group:
						sii_condition += f"AND sii.item_group = '{item_group}'";
					pos_invoice_items = frappe.db.sql(f"""
						SELECT sii.item_code as item,
							SUM(sii.stock_qty) as quantity,
							SUM(sii.amount) as value,
							sii.item_group as item_group
						FROM `tabPOS Invoice Item` as sii
						WHERE {sii_condition}
						GROUP BY sii.item_code
					""", as_dict = True);
					
					insert_index = data.index(item) + 1;
					for invoice_item in pos_invoice_items:
						invoice_item['indent'] = item['indent'] + 1;
						invoice_item['warehouse'] = None;
						invoice_item['population_tier'] = None;

						item['quantity'] = item['quantity'] + invoice_item['quantity'] if item.get('quantity') else invoice_item['quantity'];
						item['value'] = item['value'] + invoice_item['value'] if item.get('value') else invoice_item['value'];

						parent = item['parent_warehouse'];

						while parent:
							parent_row = list(filter(lambda x: x['warehouse'] == parent, data));
							if parent_row:
								parent_row = parent_row[0];
								parent_row['quantity'] = parent_row['quantity'] + invoice_item['quantity'] if parent_row.get('quantity') else invoice_item['quantity'];
								parent_row['value'] = parent_row['value'] + invoice_item['value'] if parent_row.get('value') else invoice_item['value'];
								parent = parent_row['parent_warehouse'];
					data[ insert_index:insert_index ] = pos_invoice_items;
		elif view_type_option == 'Range':
			value_or_qty = 'SUM(sii.stock_qty) ' if value_or_quantity == "Quantity" else 'SUM(sii.amount) ';
			date_columns = [];

			num_days = date_diff(to_date, from_date) + 1;
			for i in range(num_days):
				result_date = get_datetime(add_days(from_date, i));
				date_columns.append(result_date.date());

			for item in data:
				sii_condition = get_pos_invoice_item_condition(item, pos_invoice_list);

				if sii_condition:

					if item_group:
						sii_condition += f"AND sii.item_group = '{item_group}'";

					pos_invoice_items = frappe.db.sql(f"""
						SELECT DISTINCT sii.item_code as item,
						sii.item_group as item_group
						FROM `tabPOS Invoice Item` as sii
						WHERE {sii_condition}
					""", as_dict = True);
					pos_invoice_items = [{ 'item': x['item'], 'item_group': x['item_group'] } for x in pos_invoice_items];
					
					for x in pos_invoice_items:
						item_code = x['item'];
						for date_column in date_columns:
							value_or_qty_sum = frappe.db.sql(f"""
								SELECT {value_or_qty}
								FROM `tabPOS Invoice Item` as sii
								WHERE {sii_condition} AND sii.item_code = '{item_code}' AND DATE_FORMAT(sii.creation, '%Y-%m-%d') = '{date_column}'
								GROUP BY sii.item_code
							""", as_list = True);
							x[str(date_column)] = value_or_qty_sum[0][0] if value_or_qty_sum else 0;

							item[str(date_column)] = item[str(date_column)] + x[str(date_column)] if item.get(str(date_column)) else x[str(date_column)];

							parent = item["parent_warehouse"];

							while parent:
								parent_row = list(filter(lambda row: row['warehouse'] == parent, data));
								if parent_row:
									parent_row = parent_row[0];
									parent_row[str(date_column)] = parent_row[str(date_column)] + x[str(date_column)] if parent_row.get(str(date_column)) else x[str(date_column)];
									parent = parent_row['parent_warehouse'];
						
					insert_index = data.index(item) + 1;
					for invoice_item in pos_invoice_items:
						invoice_item['indent'] = item['indent'] + 1;
						invoice_item['warehouse'] = None;
						invoice_item['population_tier'] = None;

					data[ insert_index:insert_index ] = pos_invoice_items;
		else:
			value_or_qty = 'SUM(sii.stock_qty) ' if value_or_quantity == "Quantity" else 'SUM(sii.amount) ';

			for item in data:
				sii_condition = get_pos_invoice_item_condition(item, pos_invoice_list);

				if sii_condition:

					if item_group:
						sii_condition += f"AND sii.item_group = '{item_group}'";

					pos_invoice_items = frappe.db.sql(f"""
						SELECT DISTINCT sii.item_code as item,
						sii.item_group as item_group
						FROM `tabPOS Invoice Item` as sii
						WHERE {sii_condition}
					""", as_dict = True);
					pos_invoice_items = [{ 'item': x['item'], 'item_group': x['item_group'] } for x in pos_invoice_items];
					
					for x in pos_invoice_items:
						item_code = x['item'];

						from_value_or_qty_sum = frappe.db.sql(f"""
								SELECT {value_or_qty}
								FROM `tabPOS Invoice Item` as sii
								WHERE {sii_condition} AND sii.item_code = '{item_code}' AND DATE_FORMAT(sii.creation, '%Y-%m-%d') = '{from_date}'
								GROUP BY sii.item_code
							""", as_list = True);
						x[str(from_date)] = from_value_or_qty_sum[0][0] if from_value_or_qty_sum else 0;

						to_value_or_qty_sum = frappe.db.sql(f"""
								SELECT {value_or_qty}
								FROM `tabPOS Invoice Item` as sii
								WHERE {sii_condition} AND sii.item_code = '{item_code}' AND DATE_FORMAT(sii.creation, '%Y-%m-%d') = '{to_date}'
								GROUP BY sii.item_code
							""", as_list = True);
						x[str(to_date)] = to_value_or_qty_sum[0][0] if to_value_or_qty_sum else 0;

						item[str(from_date)] = item[str(from_date)] + x[str(from_date)] if item.get(str(from_date)) else x[str(from_date)];
						item[str(to_date)] = item[str(to_date)] + x[str(to_date)] if item.get(str(to_date)) else x[str(to_date)];

						parent = item["parent_warehouse"];

						while parent:
							parent_row = list(filter(lambda row: row['warehouse'] == parent, data));
							if parent_row:
								parent_row = parent_row[0];
								parent_row[str(from_date)] = parent_row[str(from_date)] + x[str(from_date)] if parent_row.get(str(from_date)) else x[str(from_date)];
								parent_row[str(to_date)] = parent_row[str(to_date)] + x[str(to_date)] if parent_row.get(str(to_date)) else x[str(to_date)];
								parent = parent_row['parent_warehouse'];

					insert_index = data.index(item) + 1;
					for invoice_item in pos_invoice_items:
						invoice_item['indent'] = item['indent'] + 1;
						invoice_item['warehouse'] = None;
						invoice_item['population_tier'] = None;

					data[ insert_index:insert_index ] = pos_invoice_items;

		return data;

	data, columns = get_data(), get_columns(from_date, to_date);

	return columns, data;