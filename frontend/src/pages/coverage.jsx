import { Link } from "react-router-dom";
import Layout from "../components/Layout";
import Status from "../components/Status";
import { useResource, number, dateTime } from "../lib/api";

const states = {
  completed: "Полностью",
  partial: "Есть расхождения",
  limited: "Выборка",
  pending: "Ожидает",
  running: "Собирается",
  failed: "Ошибка",
  cancelled: "Остановлено",
};
export default function Coverage() {
  const resource = useResource("/coverage");
  const data = resource.data;
  const summary = data?.summary;
  const issues =
    data?.tasks.filter((task) => ["failed", "partial"].includes(task.status)) ||
    [];
  return (
    <Layout title="Полнота данных">
      <div className="page-heading">
        <div>
          <h1>
            Полнота данных<span className="accent">.</span>
          </h1>
          <p>Структура источника и фактическое покрытие последнего сбора.</p>
        </div>
        <Link className="button secondary" to="/scraper">
          Сбор данных ↗
        </Link>
      </div>
      <Status loading={resource.loading} error={resource.error} empty={false}>
        {data && (
          <>
            <div className="coverage-cards">
              <div className="panel">
                <span>Категорий в дереве Kaspi</span>
                <strong>{number(data.discovery?.categories_count)}</strong>
                <small>Обновлено {dateTime(data.discovery?.finished_at)}</small>
              </div>
              <div className="panel">
                <span>Конечных подкатегорий</span>
                <strong>{number(data.discovery?.leaves_count)}</strong>
                <small>Включая все уровни вложенности</small>
              </div>
              <div className="panel">
                <span>Полностью пройдено в запуске</span>
                <strong>
                  {number(summary.completed)} / {number(summary.total)}
                </strong>
                <small>Город {data.scope.cityId || "не выбран"}</small>
              </div>
            </div>
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>
                    {data.fullCatalogComplete
                      ? "Все ветки каталога пройдены"
                      : data.complete
                        ? "Выбранная область пройдена"
                        : "Сбор каталога выполнен частично"}
                  </h2>
                  <p>
                    {data.scope.categoryId
                      ? `Выбран раздел ${data.scope.categoryId}. `
                      : ""}
                    Сохранено {number(summary.pages)} страниц и{" "}
                    {number(summary.found)} наблюдений товаров.
                  </p>
                </div>
              </div>
              <div className="coverage-summary">
                <p>
                  Ограничены по числу страниц{" "}
                  <strong>{number(summary.limited)}</strong>
                </p>
                <p>
                  Ошибки или расхождения{" "}
                  <strong>{number(summary.failed + summary.partial)}</strong>
                </p>
                <p>
                  Ожидают обработки{" "}
                  <strong>{number(summary.pending + summary.running)}</strong>
                </p>
              </div>
              <p className="data-caption">
                Количество товаров источника сверяется с уникальными карточками
                в каждой ветке. Один товар может встречаться в нескольких
                ветках. Предложения конкурентов запрашиваются отдельно при
                сравнении цен.
              </p>
            </section>
            {issues.length > 0 && (
              <section className="panel">
                <div className="panel-heading">
                  <h2>Требуют повторной проверки</h2>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Категория</th>
                        <th>Результат</th>
                        <th>Найдено / заявлено</th>
                        <th>Причина</th>
                      </tr>
                    </thead>
                    <tbody>
                      {issues.slice(0, 100).map((task) => (
                        <tr key={task.category_id}>
                          <td>
                            <Link to={`/categories/${task.category_id}`}>
                              {task.name}
                            </Link>
                          </td>
                          <td>{states[task.status]}</td>
                          <td>
                            {number(task.found_count)} /{" "}
                            {number(task.expected_latest)}
                          </td>
                          <td>
                            {task.error ||
                              "Количество или состав выдачи изменились во время сбора"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            {!data.runId && (
              <div className="data-note">
                <p>
                  Новый запуск сверит страницы и количество товаров с
                  источником.
                </p>
              </div>
            )}
          </>
        )}
      </Status>
    </Layout>
  );
}
