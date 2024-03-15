from flask import Flask, request, jsonify
from pyspark.ml.regression import LinearRegressionModel

# Initialize Flask app
app = Flask(__name__)

# Load the saved model
model = LinearRegressionModel.load("path/to/saved/model")

@app.route("/predict", methods=["POST"])
def predict():
    # Get input data from request
    data = request.json

    # Perform prediction using the loaded model
    prediction = model.transform(data)

    # Return prediction
    return jsonify(prediction)

if __name__ == "__main__":
    app.run(debug=True)