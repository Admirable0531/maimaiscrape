#!/usr/bin/env node
/**
 * Export Ryan's rating history from user_info as CSV:
 *   rating,date,time
 *   16301,10/2/2026,22:23
 * Uses user_info where user === 'ryan'. Date from doc.date (or _id); time from _id insert timestamp.
 *
 * Run: node server/scripts/export-ryan-rating-csv.js
 * Save to file: node server/scripts/export-ryan-rating-csv.js > ryan-rating.csv
 * With Docker: docker compose run --rm api node server/scripts/export-ryan-rating-csv.js
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

function pad(n) {
  return n < 10 ? `0${n}` : String(n);
}

function formatDate(d) {
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

function formatTime(d) {
  const h = d.getHours();
  const m = pad(d.getMinutes());
  return h === 0 ? `0:${m}` : `${h}:${m}`;
}

function parseStoredDate(str) {
  if (!str) return null;
  const s = String(str).trim();
  const match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return null;
  const [, a, b, y] = match;
  const n1 = parseInt(a, 10);
  const n2 = parseInt(b, 10);
  if (n1 > 12) return new Date(y, n2 - 1, n1);
  if (n2 > 12) return new Date(y, n1 - 1, n2);
  return new Date(y, n2 - 1, n1);
}

async function main() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/';
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('mydatabase');
  const cursor = db
    .collection('user_info')
    .find({ user: 'ryan' })
    .sort({ _id: 1 });
  const rows = [];
  for await (const doc of cursor) {
    const rating = doc.rating != null ? String(doc.rating).trim() : '';
    const dateFromDoc = parseStoredDate(doc.date);
    const idTimestamp = doc._id && doc._id.getTimestamp ? doc._id.getTimestamp() : null;
    const d = dateFromDoc || idTimestamp || new Date();
    const dateStr = formatDate(d);
    const timeStr = idTimestamp ? formatTime(idTimestamp) : (dateFromDoc ? formatTime(dateFromDoc) : '0:00');
    rows.push([rating, dateStr, timeStr]);
  }
  await client.close();

  const lines = ['rating,date,time', ...rows.map((r) => r.join(','))];
  console.log(lines.join('\n'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
