// backend/controllers/categoryController.js
const pool = require('../models/db');

// Вычисляем агрегированные метрики (кол-во товаров, продажи и выручка)
// для категории и всех её подкатегорий
async function getCategoryMetrics(categoryId) {
  const res = await pool.query(`
    WITH RECURSIVE subcats AS (
      SELECT id FROM categories WHERE id = $1
      UNION ALL
      SELECT c.id
      FROM categories c
      JOIN subcats s ON c.parent_id = s.id
    )
    SELECT
      COUNT(p.id)                                             AS products_count,
      COALESCE(SUM(p.reviews_count), 0)                       AS sales,
      COALESCE(SUM(p.parsed_price * p.reviews_count), 0)      AS revenue
    FROM products p
    WHERE p.category_id IN (SELECT id FROM subcats);
  `, [categoryId]);
  return res.rows[0];
}

// GET /categories?parentId=...
exports.getCategories = async (req, res) => {
  try {
    const { parentId } = req.query;
    const params = [];

    // Условие для первой части CTE (без алиаса)
    const initialWhere = parentId
      ? 'parent_id = $1'
      : 'parent_id IS NULL';

    if (parentId) {
      params.push(parentId);
    }

    // Условие для итогового SELECT (с алиасом c)
    const finalWhere = parentId
      ? 'c.parent_id = $1'
      : 'c.parent_id IS NULL';

    const sql = `
      WITH RECURSIVE tree(root, id) AS (
        SELECT id, id
        FROM categories
        WHERE ${initialWhere}

        UNION ALL

        SELECT tree.root, c2.id
        FROM categories c2
        JOIN tree ON c2.parent_id = tree.id
      ),
      metrics AS (
        SELECT
          tree.root                    AS cat_id,
          COUNT(p.id)                  AS products_count,
          SUM(p.reviews_count)         AS sales,
          SUM(p.parsed_price * p.reviews_count) AS revenue
        FROM tree
        JOIN products p ON p.category_id = tree.id
        GROUP BY tree.root
      )
      SELECT
        c.id,
        c.name,
        c.parent_id,
        c.level,
        EXISTS(
          SELECT 1 FROM categories c3 WHERE c3.parent_id = c.id
        )                             AS has_children,
        COALESCE(m.products_count, 0) AS products_count,
        COALESCE(m.sales, 0)          AS sales,
        COALESCE(m.revenue, 0)        AS revenue
      FROM categories c
      LEFT JOIN metrics m ON m.cat_id = c.id
      WHERE ${finalWhere}
      ORDER BY c.id;
    `;

    const result = await pool.query(sql, params);
    res.json({ categories: result.rows });
  } catch (err) {
    console.error('Error fetching categories:', err);
    res.status(500).json({ error: 'Error fetching categories' });
  }
};

// GET /categories/:id
exports.getCategoryById = async (req, res) => {
  try {
    const id = req.params.id;
    const catRes = await pool.query(
      'SELECT id, name, parent_id, level FROM categories WHERE id = $1',
      [id]
    );
    if (catRes.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }
    const category = catRes.rows[0];
    const m = await getCategoryMetrics(id);
    category.products_count = parseInt(m.products_count, 10);
    category.sales          = parseInt(m.sales, 10);
    category.revenue        = parseFloat(m.revenue);

    res.json({ category });
  } catch (err) {
    console.error('Error fetching category:', err);
    res.status(500).json({ error: 'Error fetching category' });
  }
};
