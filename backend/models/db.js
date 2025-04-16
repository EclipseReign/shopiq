// models/db.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.query(`
  CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    category TEXT,
    name TEXT,
    price TEXT,
    parsed_price NUMERIC,
    brand TEXT,
    rating NUMERIC,
    reviews_count INT,
    installment_price TEXT,
    computed_revenue NUMERIC,
    image_url TEXT,
    scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`, (err, res) => {
  if (err) {
    console.error('Error creating products table:', err);
  } else {
    console.log("Products table ready");
  }
});

pool.query(`
  CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT,
    parent_id INTEGER REFERENCES categories(id),
    level INTEGER NOT NULL
  );
`, (err, res) => {
  if (err) {
    console.error('Error creating categories table:', err);
  } else {
    console.log("Categories table ready");
  }
});

module.exports = pool;
