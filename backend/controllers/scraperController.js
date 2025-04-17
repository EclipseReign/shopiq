const pool = require('../models/db');
const { exec } = require('child_process');

// Запуск python-скрипта
exports.triggerScraping = (req, res) => {
  exec('python ../scraper/scraper.py', (error, stdout, stderr) => {
    if (error) {
      console.error(`Error executing scraper: ${error}`);
      return res.status(500).json({ error: 'Scraper execution failed' });
    }
    res.json({ message: 'Scraping completed', output: stdout });
  });
};

// GET /products?categoryId=...&sort=...&search=...&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
exports.getProducts = async (req, res) => {
  try {
    const { categoryId, sort, search } = req.query;

    let sql = `
      SELECT
        id,
        category_id,
        name,
        parsed_price,
        rating,
        reviews_count,
        computed_revenue,
        image_url
      FROM products
    `;
    const conditions = [];
    const params = [];

    if (categoryId) {
      params.push(categoryId);
      conditions.push(`category_id = $${params.length}`);
    }
    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      conditions.push(`name ILIKE $${params.length}`);
    }
    if (conditions.length) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    if (sort === 'price-asc')       sql += ' ORDER BY parsed_price ASC';
    else if (sort === 'price-desc') sql += ' ORDER BY parsed_price DESC';
    else if (sort === 'rating')     sql += ' ORDER BY rating DESC';
    else                             sql += ' ORDER BY scraped_at DESC';

    const result = await pool.query(sql, params);
    res.json({ products: result.rows });
  } catch (err) {
    console.error('Error fetching products', err);
    res.status(500).json({ error: 'Error fetching products' });
  }
};
