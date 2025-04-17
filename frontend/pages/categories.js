// frontend/pages/categories.js
import Layout from '../components/Layout';
import ExpandableCategoryTable from '../components/ExpandableCategoryTable';

export default function CategoriesPage() {
  return (
    <Layout>
      <h2 className="text-2xl font-bold mb-6">Выбор ниши</h2>
      <ExpandableCategoryTable />
    </Layout>
  );
}
