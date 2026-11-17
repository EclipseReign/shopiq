import { useState } from "react";
import { money, number, rating, dateTime } from "../lib/api";
import { cityName } from "../lib/cities";

function safeProductUrl(value) {
  return typeof value === "string" &&
    /^https:\/\/kaspi\.kz\/shop\/p\//.test(value)
    ? value
    : null;
}

function ProductImage({ url }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const visible = url && /^https:\/\//.test(url) && failedUrl !== url;
  return (
    <div className="product-image">
      {visible ? (
        <img
          src={url}
          loading="lazy"
          referrerPolicy="no-referrer"
          width="44"
          height="48"
          alt=""
          onError={() => setFailedUrl(url)}
        />
      ) : (
        <span aria-hidden="true">▤</span>
      )}
    </div>
  );
}

export default function ProductTable({ products }) {
  return (
    <div className="table-scroll">
      <table className="product-table">
        <thead>
          <tr>
            <th>Товар</th>
            <th className="numeric">Цена</th>
            <th className="numeric">Отзывы</th>
            <th className="numeric">Рейтинг</th>
            <th>Обновление</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.id}>
              <td>
                <div className="product-cell">
                  <ProductImage url={product.image_url} />
                  <div>
                    {safeProductUrl(product.product_url) ? (
                      <a
                        className="product-name"
                        href={safeProductUrl(product.product_url)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {product.name} <span className="external-arrow">↗</span>
                      </a>
                    ) : (
                      <span className="product-name">{product.name}</span>
                    )}
                    <small>
                      {product.category_name || "Категория неизвестна"}
                      {" · "}
                      {cityName(product.city_id)}
                    </small>
                  </div>
                </div>
              </td>
              <td className="numeric price" data-label="Цена">
                {money(product.parsed_price)}
              </td>
              <td className="numeric" data-label="Отзывы">
                {number(product.reviews_count)}
              </td>
              <td className="numeric" data-label="Рейтинг">
                <span className={product.rating == null ? "muted" : "rating"}>
                  {product.rating == null ? "" : "★ "}
                  {rating(product.rating)}
                </span>
              </td>
              <td className="date-cell" data-label="Обновление">
                {dateTime(product.scraped_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
