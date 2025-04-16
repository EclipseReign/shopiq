export default function ProductTable({ products }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Изображение</th>
          <th>Название</th>
          <th>Цена</th>
          <th>Рейтинг</th>
          <th>Выручка</th>
        </tr>
      </thead>
      <tbody>
        {products.map((product) => (
          <tr key={product.id}>
            <td>
              <img src={product.image_url} alt={product.name} />
            </td>
            <td>{product.name}</td>
            <td>{product.parsed_price} ₸</td>
            <td>{product.rating}</td>
            <td>{product.computed_revenue} ₸</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
