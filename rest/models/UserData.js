const mongoose = require('mongoose');

const mainSchema = new mongoose.Schema({
  user: String,
  img_src: String,
  name: String,
  rating: Number,
  date: String
});

// Create the model
const userData = mongoose.model('userData', mainSchema, 'user_info');

module.exports = userData;
