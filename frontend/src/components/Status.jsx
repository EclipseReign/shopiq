export default function Status({ loading, error, empty, children }) {
  if (loading)
    return (
      <div className="state-panel" role="status">
        <span className="spinner" />
        Загружаем данные…
      </div>
    );
  if (error)
    return (
      <div className="state-panel error" role="alert">
        <strong>Не удалось загрузить данные</strong>
        <p>{error}</p>
        <button
          className="button secondary"
          onClick={() => window.location.reload()}
        >
          Повторить
        </button>
      </div>
    );
  if (empty)
    return (
      <div className="state-panel">
        <span className="empty-icon" aria-hidden="true">
          ⌕
        </span>
        <strong>Здесь пока нет товаров</strong>
        <p>Измените фильтры или запустите сбор данных для этой категории.</p>
      </div>
    );
  return children;
}
