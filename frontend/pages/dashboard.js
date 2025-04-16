import { useState, useEffect } from "react";
import Layout from "../components/Layout";
import FilterSort from "../components/FilterSort";
import ProductTable from "../components/ProductTable";

export default function Dashboard() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    category: "Все",
    sort: "default"
  });

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        setLoading(true);
        const res = await fetch(
          `/api/products?category=${encodeURIComponent(filters.category)}&sort=${filters.sort}`
        );
        const data = await res.json();
        setProducts(data.products);
      } catch (error) {
        console.error("Ошибка загрузки:", error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchProducts();
  }, [filters]);

  const handleFilterSort = (category, sort) => {
    setFilters({ category, sort });
  };

  return (
    <Layout>
      <div className="space-y-6">
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
    </Layout>
  );
}