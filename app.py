from flask import Flask, send_from_directory, render_template, Response
import os

app = Flask(__name__)


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/data/<path:filename>")
def data(filename):
    # Handle gzipped files
    if filename.endswith(".gz"):
        response = send_from_directory("data", filename)
        response.headers["Content-Encoding"] = "gzip"
        response.headers["Content-Type"] = "application/json"
        return response
    return send_from_directory("data", filename)


@app.route("/static/<path:filename>")
def static_files(filename):
    return send_from_directory("static", filename)


if __name__ == "__main__":
    app.run(debug=True, port=8080)
