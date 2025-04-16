import Link from 'next/link';

export default function CategoryTree({ categories }) {
  return (
    <div>
      <ul>
        {categories.map((category) => (
          <li key={category.id}>
            <Link href={`/categories/${category.id}`}>{category.name}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
