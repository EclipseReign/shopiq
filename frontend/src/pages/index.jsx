import { Link } from "react-router-dom";
import Layout from "../components/Layout";
import Metrics from "../components/Metrics";
import ExpandableCategoryTable from "../components/ExpandableCategoryTable";
import Status from "../components/Status";
import { useResource, dateTime, money, number } from "../lib/api";

export default function Home() {
  const overview = useResource("/overview");
  const categories = useResource("/categories");
  const summary = overview.data?.overview;
  const topCategories =
    categories.data?.categories
      .filter((category) => category.products_count > 0)
      .slice(0, 5) || [];
  const maxCount = topCategories[0]?.products_count || 1;
  return (
    <Layout title="Обзор">
      <div className="page-heading">
        <div>
          <div className="eyebrow">KASPI · КАЗАХСТАН</div>
          <h1>
            Обзор каталога<span className="accent">.</span>
          </h1>
          <p>Исследуйте каталог, сравнивайте цены и находите свою нишу.</p>
        </div>
        <Link className="button primary" to="/scraper">
          <span aria-hidden="true">↻</span> Обновить данные
        </Link>
      </div>
      <div className="freshness">
        <span className="source-dot" />
        <span>Последнее наблюдение {dateTime(summary?.last_updated)}</span>
        <span className="source-tag">kaspi.kz</span>
      </div>
      <Status loading={overview.loading} error={overview.error}>
        <Metrics overview={summary} />
      </Status>
      <div className="overview-grid">
        <section className="panel distribution">
          <div className="panel-heading">
            <div>
              <h2>Где сосредоточен ассортимент</h2>
              <p>Крупнейшие категории по числу сохранённых товаров</p>
            </div>
            <Link className="text-link" to="/categories">
              Все категории ↗
            </Link>
          </div>
          <Status
            loading={categories.loading}
            error={categories.error}
            empty={!topCategories.length}
          >
            <div className="bar-chart">
              {topCategories.map((category, index) => (
                <Link
                  className="bar-row"
                  key={category.id}
                  to={`/categories/${category.id}`}
                >
                  <div>
                    <span>{category.name}</span>
                    <strong>{number(category.products_count)}</strong>
                  </div>
                  <div className="bar-track">
                    <span
                      style={{
                        width: `${(category.products_count / maxCount) * 100}%`,
                        opacity: 1 - index * 0.11,
                      }}
                    />
                  </div>
                </Link>
              ))}
            </div>
          </Status>
        </section>
        <section className="insight-card">
          <div className="eyebrow">ЦЕНОВОЙ ДИАПАЗОН</div>
          <h2>
            От доступного
            <br />
            до премиального
          </h2>
          <p>Разброс цен в сохранённом каталоге</p>
          <div className="price-range">
            <div>
              <span>Минимум</span>
              <strong>{money(summary?.min_price)}</strong>
            </div>
            <div>
              <span>Максимум</span>
              <strong>{money(summary?.max_price)}</strong>
            </div>
          </div>
          <Link to="/dashboard">
            Изучить товары <span>↗</span>
          </Link>
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Категории каталога</h2>
            <p>Раскройте раздел, чтобы перейти к подкатегориям</p>
          </div>
          <span className="count-label">
            {number(categories.data?.categories.length)} разделов
          </span>
        </div>
        <ExpandableCategoryTable
          categories={categories.data?.categories}
          loading={categories.loading}
          error={categories.error}
        />
      </section>
      <div className="data-note">
        <span aria-hidden="true">ⓘ</span>
        <p>
          Показатели рассчитаны по сохранённым карточкам. Для оценки спроса
          доступны отзывы и рейтинг. Сведения о продажах и выручке продавцов в
          каталоге отсутствуют.
        </p>
      </div>
    </Layout>
  );
}
