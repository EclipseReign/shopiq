// controllers/scraperController.js
const pool = require('../models/db');
const { exec } = require('child_process');

exports.triggerScraping = (req, res) => {
  // Запускаем парсинг, например, из командной строки python-скриптом
  exec('python ../scraper/scraper.py', (error, stdout, stderr) => {
    if (error) {
      console.error(`Error executing scraper: ${error}`);
      return res.status(500).json({ error: 'Scraper execution failed' });
    }
    res.json({ message: 'Scraping completed', output: stdout });
  });
};

exports.getProducts = (req, res) => {
  const { categoryId, sort, search } = req.query;
  
  let sql = `SELECT * FROM products`;
  let params = [];
  const conditions = [];

  // Фильтрация по категории: если передан categoryId
  if (categoryId) {
    conditions.push(`category_id = $${params.length + 1}`);
    params.push(categoryId);
  }
  // Фильтрация по поиску в названии товара
  if (search && search.trim() !== "") {
    conditions.push(`name ILIKE $${params.length + 1}`);
    params.push(`%${search.trim()}%`);
  }
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }

  // Сортировка
  if (sort === "price-asc") {
    sql += " ORDER BY parsed_price ASC";
  } else if (sort === "price-desc") {
    sql += " ORDER BY parsed_price DESC";
  } else if (sort === "rating") {
    sql += " ORDER BY rating DESC";
  } else {
    sql += " ORDER BY scraped_at DESC";
  }

  pool.query(sql, params, (err, result) => {
    if (err) {
      console.error("Error fetching products", err);
      return res.status(500).json({ error: "Error fetching products" });
    }
    res.json({ products: result.rows });
  });
};
