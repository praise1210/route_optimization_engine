"""Optional Routefinder front page; existing project files stay unchanged.

Run ``python3 run_routefinder.py`` for the landing page at ``/`` and the original
planner at ``/planner``. ``python3 app.py`` keeps its original behavior.
"""
from app import create_app


def create_routefinder_app(initial_data=None):
    """Add a welcome page to a fresh instance of the existing application."""
    application = create_app(initial_data)

    # Reuse the original page handler without editing its HTML, CSS or JS.
    planner_view = application.view_functions['index']
    application.add_url_rule(
        '/planner', endpoint='planner', view_func=planner_view,
        strict_slashes=False,
    )

    def landing_page():
        return application.send_static_file('landing/index.html')

    # Flask maps '/' to this view on this new application instance only.
    application.view_functions['index'] = landing_page
    return application


app = create_routefinder_app()


if __name__ == '__main__':
    app.run(debug=True)
