"""Flask web app and JSON API. State is in-memory for the demo."""
from flask import Flask, jsonify, request
from graph import add_location, add_road, build_graph, load_data, update_road
from routes import shortest_path


def create_app(initial_data=None):
    app = Flask(__name__, static_folder='frontend', static_url_path='')
    network = initial_data if initial_data is not None else load_data()
    app.config['NETWORK'] = network

    @app.get('/')
    def index():
        return app.send_static_file('index.html')

    @app.get('/api/health')
    def health():
        return jsonify({'status': 'ok'})

    @app.get('/api/graph')
    def graph():
        return jsonify(network)

    @app.post('/api/locations')
    def create_location():
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            return jsonify({'error': 'Provide a JSON object'}), 400
        try:
            name = add_location(network, body.get('name'))
            return jsonify({'name': name}), 201
        except ValueError as error:
            return jsonify({'error': str(error)}), 400

    @app.post('/api/roads')
    def create_road():
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            return jsonify({'error': 'Provide a JSON object'}), 400
        try:
            road = add_road(network, body.get('start'), body.get('end'), body.get('distance'))
            return jsonify(road), 201
        except ValueError as error:
            return jsonify({'error': str(error)}), 400

    @app.patch('/api/roads/<int:road_id>')
    def set_road_status(road_id):
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            return jsonify({'error': 'Provide a JSON object'}), 400
        try:
            road = update_road(network, road_id, body.get('blocked'))
            return jsonify(road)
        except ValueError as error:
            return jsonify({'error': str(error)}), 400
        except LookupError as error:
            return jsonify({'error': str(error)}), 404

    @app.post('/api/routes')
    def calculate_route():
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            return jsonify({'error': 'Provide a JSON object'}), 400
        start, destination = body.get('start'), body.get('destination')
        if not isinstance(start, str) or not isinstance(destination, str):
            return jsonify({'error': 'Start and destination must be location names'}), 400
        try:
            result = shortest_path(build_graph(network), start, destination)
        except ValueError as error:
            return jsonify({'error': str(error)}), 400
        if result is None:
            return jsonify({'error': 'No available route'}), 404
        return jsonify(result)

    return app


app = create_app()

if __name__ == '__main__':
    app.run(debug=True)
