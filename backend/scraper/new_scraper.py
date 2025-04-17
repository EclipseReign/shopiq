# scraper.py
import os
import re
import math
from concurrent.futures import ProcessPoolExecutor
from dotenv import load_dotenv
import psycopg2
from psycopg2 import extras

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("DATABASE_URL not set!", flush=True)
    exit(1)

############################
# 1) Работа с БД
############################

def get_db_connection():
    return psycopg2.connect(DATABASE_URL, sslmode="require")

def ensure_tables_exist():
    conn = get_db_connection()
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS categories (
                id SERIAL PRIMARY KEY,
                name TEXT,
                url TEXT,
                parent_id INT REFERENCES categories(id),
                level INT
            );
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS new_products (
                id SERIAL PRIMARY KEY,
                category_id INT REFERENCES categories(id),
                name TEXT,
                price TEXT,
                parsed_price NUMERIC,
                brand TEXT,
                rating NUMERIC,
                reviews_count INT,
                computed_revenue NUMERIC,
                image_url TEXT,
                scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_prod_cat ON new_products(category_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_cat_parent ON categories(parent_id);")
    conn.commit()
    conn.close()

def fetch_categories_to_scrape():
    conn = get_db_connection()
    with conn.cursor() as cur:
        cur.execute("SELECT id, url FROM categories WHERE url IS NOT NULL;")
        rows = cur.fetchall()
    conn.close()
    return rows

############################
# 2) Инициализация драйвера
############################

def init_driver():
    chrome_options = Options()
    chrome_options.add_argument("--headless")
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    return webdriver.Chrome(
        service=Service(ChromeDriverManager().install()),
        options=chrome_options
    )

############################
# 3) Сохранение продуктов
############################

INSERT_new_products = """
INSERT INTO new_products (
    category_id, name, price, parsed_price, brand,
    rating, reviews_count, computed_revenue, image_url
) VALUES %s;
"""

def save_new_products(new_products):
    if not new_products:
        return
    conn = get_db_connection()
    with conn.cursor() as cur:
        extras.execute_values(cur, INSERT_new_products, new_products)
    conn.commit()
    conn.close()

############################
# 4) Скрейпинг одной категории
############################

def clean_price(text):
    # удаляем любые пробэлные символы: обычные, NBSP (\xa0), narrow (\u202f)
    cleaned = text.strip().replace("₸", "")
    for ch in (" ", "\xa0", "\u202f"):
        cleaned = cleaned.replace(ch, "")
    return cleaned

def scrape_category_with_driver(driver, category_id, url):
    full_url = url if url.startswith("http") else f"https://kaspi.kz{url}"
    try:
        driver.get(full_url)
        WebDriverWait(driver, 5).until(
            EC.presence_of_all_elements_located((By.CSS_SELECTOR, ".item-card"))
        )
        new_products = []

        while True:
            cards = driver.find_elements(By.CSS_SELECTOR, ".item-card")
            for card in cards:
                try:
                    # Название
                    name = card.find_element(By.CSS_SELECTOR, ".item-card__name").text.strip()

                    # Цена
                    price_txt = card.find_element(
                        By.CSS_SELECTOR, ".item-card__prices-price"
                    ).text
                    price_num = clean_price(price_txt)
                    parsed_price = float(price_num) if price_num and price_num.isdigit() else 0.0

                    # Brand
                    try:
                        brand = card.find_element(
                            By.CSS_SELECTOR, ".item-card__brand"
                        ).text.strip()
                    except:
                        brand = "Неизвестно"

                    # Rating
                    rating_class = card.find_element(
                        By.CSS_SELECTOR, ".rating"
                    ).get_attribute("class")
                    rating_match = re.search(r'_(\d+)', rating_class)
                    rating = float(rating_match.group(1)) / 10 if rating_match else 0.0

                    # Reviews count
                    reviews_txt = card.find_element(
                        By.CSS_SELECTOR, ".item-card__rating"
                    ).text
                    reviews_num = "".join(filter(str.isdigit, reviews_txt))
                    reviews = int(reviews_num) if reviews_num else 0

                    # Image
                    img = card.find_element(By.CSS_SELECTOR, "img").get_attribute("src")

                    # Собираем кортеж
                    new_products.append((
                        category_id,
                        name,
                        price_txt,
                        parsed_price,
                        brand,
                        rating,
                        reviews,
                        parsed_price * reviews,
                        img
                    ))
                except Exception as e:
                    print(f"[{category_id}] card parse error: {e}", flush=True)

            # Пагинация
            try:
                next_btn = driver.find_element(
                    By.XPATH,
                    "//li[contains(@class,'pagination__el') and contains(., 'Следующая')]"
                )
                cls = next_btn.get_attribute("class") or ""
                if "disabled" in cls.lower():
                    break
                driver.execute_script("arguments[0].click();", next_btn)
                WebDriverWait(driver, 5).until(EC.staleness_of(cards[0]))
                WebDriverWait(driver, 5).until(
                    EC.presence_of_all_elements_located((By.CSS_SELECTOR, ".item-card"))
                )
            except Exception:
                break

        save_new_products(new_products)
        print(f"[{category_id}] saved {len(new_products)} new_products", flush=True)

    except Exception as e:
        print(f"[{category_id}] scrape error: {e}", flush=True)

############################
# 5) Рабочая функция для пула
############################

def worker(chunk):
    driver = init_driver()
    for cat_id, url in chunk:
        scrape_category_with_driver(driver, cat_id, url)
    driver.quit()

############################
# 6) Точка входа
############################

def main():
    print("Start scraping...", flush=True)
    ensure_tables_exist()

    cats = fetch_categories_to_scrape()
    total = len(cats)
    print(f"Categories to scrape: {total}", flush=True)

    N = min((os.cpu_count() or 4), 8)
    chunk_size = math.ceil(total / N)
    chunks = [cats[i:i+chunk_size] for i in range(0, total, chunk_size)]

    with ProcessPoolExecutor(max_workers=N) as exe:
        exe.map(worker, chunks)

    print("Done!", flush=True)

if __name__ == "__main__":
    main()
