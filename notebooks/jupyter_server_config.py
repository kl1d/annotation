c.ServerApp.open_browser = False
c.ServerApp.allow_remote_access = False
c.ServerApp.allow_origin_pat = r"^https?://(localhost|127\.0\.0\.1):5173$"
c.ServerApp.tornado_settings = {
    "headers": {
        "Content-Security-Policy": (
            "frame-ancestors 'self' http://localhost:5173 http://127.0.0.1:5173;"
        )
    }
}
