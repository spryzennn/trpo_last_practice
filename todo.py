"""Blueprint for the to-do organizer section.

Keep organizer routes and logic in this module so the feature can be developed
in a separate branch without frequently changing the text-editor code.
"""

from flask import Blueprint, render_template


todo_bp = Blueprint("todo", __name__)


@todo_bp.get("/todo")
def index():
    """Render the to-do organizer placeholder page."""
    return render_template("todo.html", active_page="todo")
