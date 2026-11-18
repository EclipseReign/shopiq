import Layout from "../components/Layout";
import Catalog from "../components/Catalog";

export default function Dashboard() {
  return (
    <Layout title="Товары">
      <div className="page-heading">
        <div>
          <h1>
            Каталог товаров<span className="accent">.</span>
          </h1>
          <p>Сравнивайте цены, отзывы и рейтинг в одном каталоге.</p>
        </div>
      </div>
      <Catalog />
    </Layout>
  );
}
