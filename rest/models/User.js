const mongoose = require('mongoose');

const songSchema = new mongoose.Schema({
  "#": { type: String, required: true },
  Song: { type: String, required: true },
  Chart: { type: String, required: true },
  Level: { type: String, required: true },
  Achv: { type: String, required: true },
  Rank: { type: String, required: true },
  Rating: { type: Number, required: true },
  Diff: { type: String, required: true },
});

const mainSchema = new mongoose.Schema({
  new: [songSchema],
  old: [songSchema],
  rating: { type: Number, required: true },
  Date: { type: String, required: true }
});

// Create the model
const keyangTop = mongoose.model('keyangTop', mainSchema, 'keyang_top');
const kokTop = mongoose.model('kokTop', mainSchema, 'kok_top');
const marcusTop = mongoose.model('marcusTop', mainSchema, 'marcus_top');
const ryanTop = mongoose.model('ryanTop', mainSchema, 'ryan_top');
const yuanTop = mongoose.model('yuanTop', mainSchema, 'yuan_top');
const yuchenTop = mongoose.model('yuchenTop', mainSchema, 'yuchen_top');

module.exports = {
    keyangTop,
    kokTop,
    marcusTop,
    ryanTop,
    yuanTop,
    yuchenTop,
    // Export other collections/models if needed
  };
