const pool = require('../models/db');

exports.triggerScraping = (req, res) => {
  exec('python ../scraper/scraper.py', (error, stdout, stderr) => {
    if (error) {
      console.error(`Error executing scraper: ${error}`);
      return res.status(500).json({ error: 'Scraper execution failed' });
    }
    res.json({ message: 'Scraping completed', output: stdout });
  });
};

exports.getProducts = (req, res) => {
  const { category, sort } = req.query;
  
  let sql = `SELECT * FROM products`;
  const params = [];

  if (category && category !== 'Все') {
    sql += ` WHERE category = $1`;
    params.push(category);
  }

  switch(sort) {
    case 'price-asc':
      sql += ` ORDER BY parsed_price ASC`;
      break;
    case 'price-desc':
      sql += ` ORDER BY parsed_price DESC`;
      break;
    case 'rating':
      sql += ` ORDER BY rating DESC`;
      break;
    default:
      sql += ` ORDER BY scraped_at DESC`;
  }

  pool.query(sql, params, (err, result) => {
    if (err) {
      console.error('Error fetching products', err);
      return res.status(500).json({ error: 'Error fetching products' });
    }
    res.json({ products: result.rows });
  });
};