import Link from 'next/link';

export default function Home() {
  return (
    <div style={{ padding: '20px' }}>
      <h1>Добро пожаловать на Kaspi Dashboard</h1>
      <p>
        Это маркетинговая страница сервиса сбора данных о товарах Kaspi.
      </p>
      <Link href="/dashboard">
        <a>Перейти к панели управления</a>
      </Link>
    </div>
  );
}
