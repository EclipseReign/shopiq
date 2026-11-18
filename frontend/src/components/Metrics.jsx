import { money, number, rating } from "../lib/api";

export default function Metrics({ overview }) {
  const o = overview || {};
  return (
    <div className="metrics">
      <article className="metric">
        <div className="metric-label">
          Товаров в выборке <span aria-hidden="true">▤</span>
        </div>
        <strong>{number(o.products_count)}</strong>
        <small>Категорий с товарами {number(o.categories_count)}</small>
      </article>
      <article className="metric">
        <div className="metric-label">
          Средняя цена <span aria-hidden="true">₸</span>
        </div>
        <strong>{money(o.average_price)}</strong>
        <small>Цена известна у {number(o.priced_count)} товаров</small>
      </article>
      <article className="metric">
        <div className="metric-label">
          Отзывы покупателей <span aria-hidden="true">☷</span>
        </div>
        <strong>{number(o.reviews_count)}</strong>
        <small>Данные у {number(o.reviewed_count)} товаров</small>
      </article>
      <article className="metric">
        <div className="metric-label">
          Средний рейтинг <span aria-hidden="true">☆</span>
        </div>
        <strong>
          {rating(o.average_rating)}
          <span className="metric-unit"> / 5</span>
        </strong>
        <small>По {number(o.rated_count)} карточкам с рейтингом</small>
      </article>
    </div>
  );
}
