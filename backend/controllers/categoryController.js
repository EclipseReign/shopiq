// controllers/categoryController.js
const pool = require('../models/db');

// Получить список категорий
// Если передан параметр ?parentId=, вернуть подкатегории для заданного родителя,
// иначе вернуть верхнеуровневые категории (где parent_id IS NULL)
exports.getCategories = (req, res) => {
  const { parentId } = req.query;
  let sql = "SELECT * FROM categories";
  const params = [];

  if (parentId) {
    sql += " WHERE parent_id = $1";
    params.push(parentId);
  } else {
    sql += " WHERE parent_id IS NULL";
  }
  
  sql += " ORDER BY id";

  pool.query(sql, params, (err, result) => {
    if (err) {
      console.error("Error fetching categories:", err);
      return res.status(500).json({ error: "Error fetching categories" });
    }
    res.json({ categories: result.rows });
  });
};

// Получить конкретную категорию по id
exports.getCategoryById = (req, res) => {
  const { id } = req.params;
  pool.query("SELECT * FROM categories WHERE id = $1", [id], (err, result) => {
    if (err) {
      console.error("Error fetching category:", err);
      return res.status(500).json({ error: "Error fetching category" });
    }
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Category not found" });
    }
    res.json({ category: result.rows[0] });
  });
};
