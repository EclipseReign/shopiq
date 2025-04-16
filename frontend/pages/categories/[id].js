// pages/categories/[id].js
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import CategoryCardList from '../../components/CategoryCardList';
import ProductsTable from '../../components/ProductTable';

export default function CategoryDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  
  const [category, setCategory] = useState(null);
  const [subcategories, setSubcategories] = useState([]);
  const [products, setProduct] = useState([]);
  
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    if (!id) return;
    const fetchData = async () => {
      try {
        setLoading(true);
        // 1) Загружаем данные о категории
        const catRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/categories/${id}`);
        const catData = await catRes.json();
        setCategory(catData.category);

        // 2) Проверяем, есть ли подкатегории
        // (Backend: GET /categories?parentId=...)
        const subRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/categories?parentId=${id}`);
        const subData = await subRes.json();
        setSubcategories(subData.categories || []);

        // 3) Если нет подкатегорий, значит конечная категория. Загружаем товары
        if (!subData.categories || subData.categories.length === 0) {
          const prodRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/products?categoryId=${id}`);
          const prodData = await prodRes.json();
          setProduct(prodData.products || []);
        }
      } catch (error) {
        console.error('Ошибка:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id]);

  if (loading) {
    return (
      <Layout>
        <p>Загрузка...</p>
      </Layout>
    );
  }

  if (!category) {
    return (
      <Layout>
        <p>Категория не найдена.</p>
      </Layout>
    );
  }

  return (
    <Layout>
      <h2 className="text-xl font-bold mb-4">{category.name}</h2>
      <div className="mb-4 flex space-x-4">
        <div>Продажи: {category.sales?.toLocaleString() || 0}</div>
        <div>Выручка: {category.revenue?.toLocaleString() || 0} ₸</div>
        <div>Товаров: {category.products_count || 0}</div>
      </div>
      {subcategories.length > 0 ? (
        // Если есть подкатегории, показываем их списком
        <CategoryCardList categories={subcategories} />
      ) : (
        // Иначе показываем товары
        <ProductsTable products={products} />
      )}
    </Layout>
  );
}
