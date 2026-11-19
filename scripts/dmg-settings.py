import os.path

application = defines["app"]
app_name = os.path.basename(application)

format = "UDZO"
filesystem = "HFS+"
files = [application]
symlinks = {"Applications": "/Applications"}
hide_extensions = [app_name]

icon = defines["icon"]
background = defines["background"]

default_view = "icon-view"
window_rect = ((200, 120), (540, 412))
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
icon_size = 128
text_size = 13
icon_locations = {app_name: (140, 180), "Applications": (400, 180)}
