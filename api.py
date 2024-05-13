from flask import Flask, jsonify, request
from flask_pymongo import PyMongo
from bson import ObjectId

app = Flask(__name__)
app.config['MONGO_URI'] = 'mongodb://localhost:27017/mydatabase'  # Replace 'mydatabase' with your MongoDB database name
mongo = PyMongo(app)

@app.route('/user', methods=['GET'])
def get_all_users():
    items = mongo.db.user_info.find()
    output = []
    for item in items:
        output.append({'_id': str(item['_id']), 'name': item['name'], 'rating': item['rating']})
    return jsonify({'result': output})

@app.route('/user/<username>', methods=['GET'])
def get_item(username):
    items = mongo.db.user_info.find({'user': username})
    output = []

    for item in items:
        output.append({'_id': str(item['_id']), 'name': item['name'], 'rating': item['rating']})
    return jsonify({'result': output})


if __name__ == '__main__':
    app.run(debug=True)