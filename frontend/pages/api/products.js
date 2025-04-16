import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export default async function handler(req, res) {
  const { category, sort, search } = req.query;

  try {
    let queryText = `
      SELECT p.*, c.name AS category_name 
      FROM products p 
      JOIN categories c ON p.category_id = c.id
    `;
    let conditions = [];
    let values = [];
    let idx = 1;

    // Фильтрация по категории
    if (category && category !== "Все") {
      conditions.push(`c.name = $${idx}`);
      values.push(category);
      idx++;
    }

    // Поиск по названию товара
    if (search && search.trim() !== "") {
      conditions.push(`p.name ILIKE $${idx}`);
      values.push(`%${search.trim()}%`);
      idx++;
    }

    if (conditions.length > 0) {
      queryText += " WHERE " + conditions.join(" AND ");
    }

    // Сортировка
    if (sort === "price-asc") {
      queryText += " ORDER BY p.parsed_price ASC";
    } else if (sort === "price-desc") {
      queryText += " ORDER BY p.parsed_price DESC";
    } else if (sort === "rating") {
      queryText += " ORDER BY p.rating DESC";
    } else {
      queryText += " ORDER BY p.id DESC";
    }

    const result = await pool.query(queryText, values);
    res.status(200).json({ products: result.rows });
  } catch (error) {
    console.error("Ошибка при выполнении запроса:", error);
    res.status(500).json({ error: error.message });
  }
}
