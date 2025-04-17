// frontend/components/CategoryTree.js
import { useState, useEffect } from 'react';

export default function CategoryTree({ parentId = null, level = 0 }) {
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const url =
          `${process.env.NEXT_PUBLIC_API_URL}/categories` +
          (parentId ? `?parentId=${parentId}` : '');
        const res = await fetch(url);
        const { categories } = await res.json();
        setNodes(categories || []);
      } catch (e) {
        console.error('Ошибка загрузки категорий:', e);
        setNodes([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [parentId]);

  if (loading) {
    return <p className="italic text-gray-500">Загрузка...</p>;
  }

  return (
    <ul className="space-y-1">
      {nodes.map(cat => (
        <TreeNode key={cat.id} cat={cat} level={level} />
      ))}
    </ul>
  );
}

function TreeNode({ cat, level }) {
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen(o => !o);

  return (
    <li>
      <div
        className="flex items-center cursor-pointer select-none"
        style={{ paddingLeft: `${level * 1.5}rem` }}
        onClick={toggle}
      >
        {/* Стрелочка с поворотом */}
        <span
          className={`inline-block transform transition-transform duration-200 ${
            open ? 'rotate-90' : ''
          }`}
        >
          ▶
        </span>
        {/* Название + метрики */}
        <span className="ml-2">
          {cat.name}{' '}
          <span className="text-sm text-gray-600">
            ({cat.sales.toLocaleString()} шт. / {cat.revenue.toLocaleString()}{' '}
            ₸)
          </span>
        </span>
      </div>

      {/* Вложенные */}
      <div
        className={`overflow-hidden transition-[max-height] duration-300`}
        style={{
          maxHeight: open ? '1000px' : '0',
        }}
      >
        {open && (
          <CategoryTree parentId={cat.id} level={level + 1} />
        )}
      </div>
    </li>
  );
}
