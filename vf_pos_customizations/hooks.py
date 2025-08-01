app_name = "vf_pos_customizations"
app_title = "VF POS Customizations"
app_publisher = "Christine Kanga"
app_description = "POS customizations for Victory Farms"
app_email = "christinek@victoryfarmskenya.com"
app_license = "mit"

fixtures = [
    "Client Script",
    "Server Script",
    "Custom Field",
    "Property Setter",
    {"dt": "Client Script", "filters": [["module", "like", "VF POS Customizations"]]},
    {"dt": "Server Script", "filters": [["module", "like", "VF POS Customizations"]]},
    {"dt": "Custom Field", "filters": [["module", "like", "VF POS Customizations"]]},
    {"dt": "Property Setter", "filters": [["module", "like", "VF POS Customizations"]]},
]
# Apps
# ------------------

# required_apps = []

# Each item in the list will be shown as an app in the apps page
# add_to_apps_screen = [
# 	{
# 		"name": "vf_pos_customizations",
# 		"logo": "/assets/vf_pos_customizations/logo.png",
# 		"title": "VF POS Customizations",
# 		"route": "/vf_pos_customizations",
# 		"has_permission": "vf_pos_customizations.api.permission.has_app_permission"
# 	}
# ]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/vf_pos_customizations/css/vf_pos_customizations.css"
# app_include_js = "/assets/vf_pos_customizations/js/vf_pos_customizations.js"
app_include_js = [
    # "/assets/vf_pos_customizations/js/pos_controller.js",
    # "/assets/vf_pos_customizations/js/pos_past_order_list.js",
    # "/assets/vf_pos_customizations/js/pos_payment.js"
    "vf_pos_customizations.bundle.js",
]
# include js, css files in header of web template
# web_include_css = "/assets/vf_pos_customizations/css/vf_pos_customizations.css"
# web_include_js = "/assets/vf_pos_customizations/js/vf_pos_customizations.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "vf_pos_customizations/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
# doctype_js = {"doctype" : "public/js/doctype.js"} (to use)
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# doctype_js = {"Sales Invoice": "public/js/sales_invoice.js"}
# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "vf_pos_customizations/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "vf_pos_customizations.utils.jinja_methods",
# 	"filters": "vf_pos_customizations.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "vf_pos_customizations.install.before_install"
# after_install = "vf_pos_customizations.install.after_install"

# Uninstallation
# ------------

# before_uninstall = "vf_pos_customizations.uninstall.before_uninstall"
# after_uninstall = "vf_pos_customizations.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "vf_pos_customizations.utils.before_app_install"
# after_app_install = "vf_pos_customizations.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "vf_pos_customizations.utils.before_app_uninstall"
# after_app_uninstall = "vf_pos_customizations.utils.after_app_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "vf_pos_customizations.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# DocType Class
# ---------------
# Override standard doctype classes

# override_doctype_class = {
# 	"ToDo": "custom_app.overrides.CustomToDo"
# }

# Document Events (to use)
# ---------------
# Hook on document methods and events

# doc_events = {
# 	"*": {
# 		"on_update": "method",
# 		"on_cancel": "method",
# 		"on_trash": "method"
# 	}
# }

# Scheduled Tasks
# ---------------

scheduler_events = {
    "daily": [
        "vf_pos_customizations.vf_pos_customizations.doctype.pezesha_settings.pezesha_settings.corn"
    ]
}

# scheduler_events = {
# 	"all": [
# 		"vf_pos_customizations.tasks.all"
# 	],
# 	"daily": [
# 		"vf_pos_customizations.tasks.daily"
# 	],
# 	"hourly": [
# 		"vf_pos_customizations.tasks.hourly"
# 	],
# 	"weekly": [
# 		"vf_pos_customizations.tasks.weekly"
# 	],
# 	"monthly": [
# 		"vf_pos_customizations.tasks.monthly"
# 	],
# }

# Testing
# -------

# before_tests = "vf_pos_customizations.install.before_tests"

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "vf_pos_customizations.event.get_events"
# }

override_whitelisted_methods = {
    "erpnext.selling.page.point_of_sale.point_of_sale.get_past_order_list": "vf_pos_customizations.custom.point_of_sale.get_past_order_list",
    "erpnext.selling.page.point_of_sale.point_of_sale.create_payment_request": "vf_pos_customizations.custom.point_of_sale.get_past_order_list"
}

#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "vf_pos_customizations.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["vf_pos_customizations.utils.before_request"]
# after_request = ["vf_pos_customizations.utils.after_request"]

# Job Events
# ----------
# before_job = ["vf_pos_customizations.utils.before_job"]
# after_job = ["vf_pos_customizations.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"vf_pos_customizations.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

