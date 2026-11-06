"""Serve app/ on localhost and open the dev page in the default browser."""
import argparse
import functools
import http.server
import pathlib
import threading
import webbrowser

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--port", type=int, default=8765)
PORT = parser.parse_args().port
URL = f"http://localhost:{PORT}/codinghost.html?dev"
APP_DIR = pathlib.Path(__file__).resolve().parent.parent / "app"

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(APP_DIR))
server = http.server.ThreadingHTTPServer(("", PORT), handler)

# Open after bind so the browser never races the listener.
threading.Timer(0.3, webbrowser.open, args=(URL,)).start()
print(f"Serving {APP_DIR} at {URL}")
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
