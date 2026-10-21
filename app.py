import os

from flask import Flask, render_template

from todo import todo_bp

app = Flask(__name__)
app.register_blueprint(todo_bp)


@app.get("/")
def index():
    """Serve the text editor. Documents are currently stored in the browser."""
    return render_template("index.html", active_page="editor")


if __name__ == "__main__":
    # Debug mode is opt-in: set FLASK_DEBUG=1 for local development.
    debug_enabled = os.environ.get("FLASK_DEBUG", "").lower() in {"1", "true", "yes"}
    app.run(debug=debug_enabled)
