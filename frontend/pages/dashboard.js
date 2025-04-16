import { useState, useEffect } from "react";
import Layout from "../components/Layout";
import FilterSort from "../components/FilterSort";
import ProductTable from "../components/ProductTable";
import CategoryTree from "../components/CategoryTree";

export default function Dashboard() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Фильтры: выбранная категория, порядок сортировки и поисковый запрос.
  const [selectedCategory, setSelectedCategory] = useState("Все");
  const [sort, setSort] = useState("default");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams({
          category: selectedCategory,
          sort: sort,
          search: search,
        });
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/products?${params.toString()}`
        );
        const data = await res.json();
        // Проверка на наличие поля products
        if (Array.isArray(data.products)) {
          setProducts(data.products);
        } else {
          console.error("Не удалось загрузить товары. Ожидался массив 'products'.");
          setProducts([]); // Устанавливаем пустой массив в случае ошибки
        }
      } catch (error) {
        console.error("Ошибка загрузки товаров:", error);
        setProducts([]); // Устанавливаем пустой массив в случае ошибки
      } finally {
        setLoading(false);
      }
    };
  
    fetchProducts();
  }, [selectedCategory, sort, search]);

  // Обработчик выбора категории из дерева категорий
  const handleCategorySelect = (categoryName) => {
    setSelectedCategory(categoryName);
  };

  // Обработчик фильтрации/сортировки и поиска из компонента FilterSort
  const handleFilterSort = (category, sortOption, searchTerm) => {
    // Если фильтрация идёт через дерево категорий, можно не изменять выбранную категорию здесь,
    // либо задать значение по умолчанию.
    setSort(sortOption);
    setSearch(searchTerm);
  };

  return (
    <Layout>
      <div className="flex flex-col md:flex-row gap-4">
        <div className="md:w-1/4">
          <CategoryTree onSelectCategory={handleCategorySelect} />
        </div>
        <div className="md:w-3/4">
          <FilterSort onFilterSort={handleFilterSort} />
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin inline-block w-8 h-8 border-4 border-blue-500 rounded-full border-t-transparent"></div>
              <p className="mt-4 text-gray-600">Загрузка данных...</p>
            </div>
          ) : (
            <ProductTable products={products} />
          )}
        </div>
      </div>
    </Layout>
  );
}
