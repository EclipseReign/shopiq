// pages/categories.js
import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import CategoryCardList from '../components/CategoryCardList';

export default function CategoriesPage() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCats = async () => {
      try {
        setLoading(true);
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/categories`);
        const data = await res.json();
        // Предположим, что data.categories уже содержит
        // поля: id, name, parent_id, level, products_count, revenue, status
        setCategories(data.categories.filter(cat => cat.parent_id === null));
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchCats();
  }, []);

  return (
    <Layout>
      <div className="space-y-4">
        <h2 className="text-xl font-bold">Список категорий</h2>
        {loading ? (
          <p>Загрузка...</p>
        ) : (
          <CategoryCardList categories={categories} />
        )}
      </div>
    </Layout>
  );
}
