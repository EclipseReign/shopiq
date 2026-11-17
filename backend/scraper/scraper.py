"""Bounded Kaspi collection, with per-page transactions and explicit failures."""

import argparse
import json
import os
import re
import signal
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlencode

from parsing import kaspi_url, parse_price, parse_rating, parse_reviews
from storage import connect, initialize, save_products

STOP = threading.Event()


def emit(**event):
    print(json.dumps(event, ensure_ascii=False), flush=True)


def init_driver():
    from selenium import webdriver

    options = webdriver.ChromeOptions()
    options.add_argument("--headless=new")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--window-size=1440,1000")
    options.page_load_strategy = "eager"
    options.add_experimental_option(
        "prefs", {"profile.managed_default_content_settings.images": 2}
    )
    if os.getenv("CHROME_BINARY"):
        options.binary_location = os.environ["CHROME_BINARY"]
    driver = webdriver.Chrome(options=options)
    driver.set_page_load_timeout(40)
    return driver


EXTRACT_CARDS = """
return [...document.querySelectorAll('.item-card')].map(card => {
  const text = selector => card.querySelector(selector)?.textContent?.trim() ?? null;
  const anchor = card.querySelector('.item-card__name a, a.item-card__name, .item-card__image-wrapper');
  const image = card.querySelector('img');
  return {
    name: text('.item-card__name'), price: text('.item-card__debet .item-card__prices-price') || text('.item-card__prices-price'),
    brand: text('.item-card__brand'), rating_class: card.querySelector('.rating')?.className,
    reviews_text: text('.item-card__rating a'), image_url: image?.getAttribute('src') || image?.getAttribute('data-src'),
    external_id: card.dataset.productId, product_url: anchor?.getAttribute('href')
  };
});
"""

CARD_IDENTITIES = """
return [...document.querySelectorAll('.item-card')].map(card =>
  card.dataset.productId || card.querySelector('.item-card__name a')?.getAttribute('href')
);
"""


def normalize_card(raw, category_id):
    if not raw.get("name") or not raw.get("product_url"):
        raise ValueError("В карточке отсутствует название или ссылка")
    product_url = kaspi_url(raw["product_url"], "p")
    external_id = raw.get("external_id")
    if not external_id:
        match = re.search(r"-(\d+)/?$", product_url)
        external_id = match.group(1) if match else None
    if not external_id or not re.fullmatch(r"\d+", str(external_id)):
        raise ValueError("В карточке отсутствует ID товара")
    price = parse_price(raw.get("price"))
    if price is None:
        raise ValueError("Не удалось прочитать цену карточки")
    return {
        "category_id": category_id,
        "name": raw["name"].strip(),
        "price": raw.get("price"),
        "parsed_price": price,
        "brand": raw.get("brand"),
        "rating": parse_rating(raw.get("rating_class")),
        "reviews_count": parse_reviews(raw.get("reviews_text")),
        "image_url": raw.get("image_url"),
        "external_id": str(external_id),
        "product_url": product_url,
    }


def wait_for_stable_cards(driver):
    """Wait for incremental card rendering to settle before reading a page."""
    from selenium.webdriver.support.ui import WebDriverWait

    previous = None
    stable_since = time.monotonic()

    def ready(browser):
        nonlocal previous, stable_since
        ids = browser.execute_script(CARD_IDENTITIES)
        signature = tuple(ids)
        if not signature or signature != previous:
            previous = signature
            stable_since = time.monotonic()
            return False
        return time.monotonic() - stable_since >= 1.0

    WebDriverWait(driver, 15, poll_frequency=0.5).until(ready)


def scrape_category(driver, category_id, url, max_pages, delay, city_id):
    from selenium.common.exceptions import TimeoutException
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC

    base_url = kaspi_url(url)
    seen_pages = set()
    total = 0
    skipped = 0
    target = base_url + "?" + urlencode({"c": city_id})
    for attempt in range(3):
        if STOP.is_set():
            return
        try:
            driver.get(target)
            WebDriverWait(driver, 25).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, ".item-card"))
            )
            break
        except TimeoutException:
            if attempt == 2:
                raise RuntimeError(
                    f"Категория {category_id} не загрузилась за 3 попытки"
                )
            if STOP.wait(delay * (attempt + 1)):
                return
    for page in range(max_pages):
        if STOP.is_set():
            break
        wait_for_stable_cards(driver)
        # Use the website's own navigation to retain its city and search state.
        raw_cards = driver.execute_script(EXTRACT_CARDS)
        products = []
        skipped_before_page = skipped
        for raw in raw_cards:
            try:
                products.append(normalize_card(raw, category_id))
            except ValueError as error:
                skipped += 1
                emit(type="warning", category_id=category_id, message=str(error))
        if not products:
            raise RuntimeError(
                f"Категория {category_id}, страница {page + 1} не содержит распознанных товаров"
            )
        signature = tuple(product["external_id"] for product in products)
        if signature in seen_pages:
            raise RuntimeError(
                f"Kaspi повторил страницу категории {category_id}. Сбор остановлен"
            )
        seen_pages.add(signature)
        total += save_products(products, city_id)
        emit(
            type="page",
            category_id=category_id,
            page=page + 1,
            saved=len(products),
            total=total,
            skipped=skipped,
        )
        yield len(products), skipped - skipped_before_page
        if page + 1 >= max_pages or STOP.wait(delay):
            break
        previous_ids = tuple(driver.execute_script(CARD_IDENTITIES))
        clicked = driver.execute_script(
            """
            const next = [...document.querySelectorAll('.pagination__el')].find(e => /Следующая|Келесі/.test(e.textContent));
            if (!next || /disabled/i.test(next.className) || next.getAttribute('aria-disabled') === 'true') return false;
            next.click();
            return true;
        """
        )
        if not clicked:
            break

        def page_changed(browser):
            identities = tuple(browser.execute_script(CARD_IDENTITIES))
            return bool(identities) and identities != previous_ids

        WebDriverWait(driver, 25).until(page_changed)


def worker(categories, args):
    driver = None
    total, skipped, errors = 0, 0, []
    try:
        driver = init_driver()
        for category_id, url in categories:
            if STOP.is_set():
                break
            try:
                category_saved = 0
                for saved, invalid in scrape_category(
                    driver, category_id, url, args.max_pages, args.delay, args.city_id
                ):
                    total += saved
                    category_saved += saved
                    skipped += invalid
                if not STOP.is_set():
                    emit(type="category", category_id=category_id, saved=category_saved)
            except Exception as error:
                message = f"Категория {category_id}: {error}"
                errors.append(message)
                emit(type="error", category_id=category_id, message=message)
    finally:
        if driver:
            driver.quit()
    return total, skipped, errors


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--category-id", type=int)
    parser.add_argument("--max-pages", type=int, default=3)
    parser.add_argument("--workers", type=int, default=1)
    parser.add_argument("--delay", type=float, default=1.5)
    parser.add_argument("--city-id", default="750000000")
    parser.add_argument("--cancel-file")
    args = parser.parse_args()
    if (
        not 1 <= args.max_pages <= 100
        or not 1 <= args.workers <= 4
        or not 1 <= args.delay <= 30
    ):
        parser.error("max-pages 1..100, workers 1..4, delay 1..30")
    if not re.fullmatch(r"\d{9}", args.city_id):
        parser.error("city-id должен состоять из 9 цифр")
    signal.signal(signal.SIGINT, lambda *_: STOP.set())
    signal.signal(signal.SIGTERM, lambda *_: STOP.set())
    if args.cancel_file:

        def watch_cancel():
            while not STOP.wait(0.5):
                if os.path.exists(args.cancel_file):
                    STOP.set()

        threading.Thread(target=watch_cancel, daemon=True).start()
    initialize()
    with connect() as db:
        if args.category_id:
            categories = db.execute(
                """WITH RECURSIVE selected(id) AS (
                SELECT id FROM categories WHERE id=? UNION SELECT c.id FROM categories c JOIN selected s ON c.parent_id=s.id
            ) SELECT c.id,c.url FROM categories c WHERE c.id IN (SELECT id FROM selected)
              AND c.url IS NOT NULL AND NOT EXISTS(SELECT 1 FROM categories child WHERE child.parent_id=c.id)
              ORDER BY c.id""",
                (args.category_id,),
            ).fetchall()
        else:
            categories = db.execute(
                """SELECT c.id,c.url FROM categories c WHERE c.url IS NOT NULL
                AND NOT EXISTS(SELECT 1 FROM categories child WHERE child.parent_id=c.id) ORDER BY c.id"""
            ).fetchall()
    if not categories:
        raise RuntimeError("Нет категорий со ссылкой Kaspi для сбора")
    workers = min(args.workers, len(categories))
    chunks = [categories[index::workers] for index in range(workers)]
    emit(
        type="start",
        categories=len(categories),
        workers=workers,
        max_pages=args.max_pages,
        city_id=args.city_id,
    )
    total, skipped, errors = 0, 0, []
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(worker, chunk, args) for chunk in chunks]
        for future in as_completed(futures):
            try:
                saved, invalid, failures = future.result()
                total += saved
                skipped += invalid
                errors.extend(failures)
            except Exception as error:
                errors.append(str(error))
                emit(type="error", message=str(error))
    emit(
        type="finish",
        saved=total,
        skipped=skipped,
        errors=errors,
        cancelled=STOP.is_set(),
    )
    return 2 if errors else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        emit(type="error", message=str(error))
        sys.exit(1)
