import os
import re
import time
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.action_chains import ActionChains
from webdriver_manager.chrome import ChromeDriverManager
import psycopg2
from psycopg2 import extras
from dotenv import load_dotenv
from concurrent.futures import ThreadPoolExecutor

load_dotenv()

DATABASE_URL = os.getenv('DATABASE_URL')
if not DATABASE_URL:
    print("DATABASE_URL environment variable not set!", flush=True)
    exit(1)

# Database functions
def get_db_connection():
    return psycopg2.connect(DATABASE_URL, sslmode='require')

def ensure_tables_exist():
    conn = get_db_connection()
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS categories (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                url TEXT,
                parent_id INTEGER REFERENCES categories(id),
                level INTEGER NOT NULL
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS products (
                id SERIAL PRIMARY KEY,
                category TEXT,
                name TEXT,
                price TEXT,
                parsed_price NUMERIC,
                brand TEXT,
                rating NUMERIC,
                reviews_count INT,
                installment_price TEXT,
                computed_revenue NUMERIC,
                image_url TEXT,
                scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.commit()
    conn.close()

def categories_exist():
    conn = get_db_connection()
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM categories")
        count = cur.fetchone()[0]
    conn.close()
    return count > 0

# Parsing functions for category data
def parse_category_file(content):
    categories = []
    stack = []
    current_level = 0
    temp_id_counter = 1
    for line in content.split('\n'):
        if not line.strip():
            continue
        indent = len(line) - len(line.lstrip())
        level = indent // 2
        line = line.strip()
        if line.startswith("Все категории:"):
            continue
        # Извлекаем имя и url
        name, url = None, None
        if "Category:" in line:
            match = re.match(r"Category: (.*?) \((.*?)\)", line)
            if match:
                name, url = match.groups()
        elif "-> Subcategory:" in line:
            match = re.match(r"-> Subcategory: (.*?) \((.*?)\)", line)
            if match:
                name, url = match.groups()
        elif ':' in line:
            name = line.replace(':', '')
        else:
            continue
        while level < current_level:
            stack.pop()
            current_level -= 1
        parent_temp_id = stack[-1]['temp_id'] if stack else None
        category = {
            'temp_id': temp_id_counter,
            'name': name,
            'url': url,
            'parent_temp_id': parent_temp_id,
            'level': level
        }
        temp_id_counter += 1
        categories.append(category)
        if level >= current_level:
            stack.append(category)
            current_level = level + 1
    return categories

def save_categories(categories):
    conn = get_db_connection()
    with conn.cursor() as cur:
        for cat in categories:
            cur.execute("""
                INSERT INTO categories (name, url, level)
                VALUES (%s, %s, %s)
                RETURNING id
            """, (cat['name'], cat['url'], cat['level']))
            cat['db_id'] = cur.fetchone()[0]
        for cat in categories:
            if cat['parent_temp_id']:
                parent_id = next(c['db_id'] for c in categories if c['temp_id'] == cat['parent_temp_id'])
                cur.execute("""
                    UPDATE categories
                    SET parent_id = %s
                    WHERE id = %s
                """, (parent_id, cat['db_id']))
        conn.commit()
    conn.close()

# Scraper functions
def init_driver():
    chrome_options = Options()
    chrome_options.add_argument("--headless")
    chrome_options.add_argument("--disable-gpu")
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-software-rasterizer")
    chrome_options.add_argument("--disable-dev-shm-usage")
    return webdriver.Chrome(
        service=Service(ChromeDriverManager().install()),
        options=chrome_options
    )

def hide_location_dialog(driver):
    try:
        driver.execute_script("""
            document.querySelectorAll('.current-location__dialog')
                .forEach(el => el.style.display = 'none');
        """)
    except Exception as e:
        print("Не удалось скрыть диалог выбора города:", e, flush=True)

def parse_rating_from_class(class_attr):
    match = re.search(r'_(\d{2})', class_attr)
    if match:
        val = match.group(1)
        try:
            return float(val) / 10.0
        except:
            return None
    return None

def scrape_category(category_id, url):
    print(f"Начинаем парсинг товаров для категории id {category_id}", flush=True)
    driver = init_driver()
    driver.get(url if url.startswith('http') else f'https://kaspi.kz{url}')
    try:
        WebDriverWait(driver, 20).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, ".item-card"))
        )
        hide_location_dialog(driver)
        products = []
        while True:
            product_cards = driver.find_elements(By.CSS_SELECTOR, ".item-card")
            for card in product_cards:
                try:
                    name = card.find_element(By.CSS_SELECTOR, ".item-card__name").text
                    price = card.find_element(By.CSS_SELECTOR, ".item-card__prices-price").text
                    parsed_price = float(price.replace(' ', '').replace('₸', ''))
                    try:
                        brand = card.find_element(By.CSS_SELECTOR, ".item-card__brand").text
                    except:
                        brand = "Неизвестно"
                    rating_class = card.find_element(By.CSS_SELECTOR, ".rating").get_attribute('class')
                    rating = float(re.search(r'_(\d+)', rating_class).group(1)) / 10
                    reviews_text = card.find_element(By.CSS_SELECTOR, ".item-card__rating").text.strip()
                    reviews_numbers = "".join(filter(str.isdigit, reviews_text))
                    reviews = int(reviews_numbers) if reviews_numbers else 0
                    image = card.find_element(By.CSS_SELECTOR, "img").get_attribute('src')
                    products.append((
                        category_id,
                        name,
                        price,
                        parsed_price,
                        brand,
                        rating,
                        reviews,
                        "",  # installment price
                        parsed_price * reviews,
                        image
                    ))
                except Exception as e:
                    print(f"Error parsing product: {e}", flush=True)
            try:
                next_btn = driver.find_element(By.XPATH, 
                    '//li[contains(@class, "pagination__el") and contains(., "Следующая")]')
                driver.execute_script("arguments[0].scrollIntoView(true);", next_btn)
                time.sleep(1)
                driver.execute_script("arguments[0].click();", next_btn)
                time.sleep(2)
            except Exception as e:
                print(f"Нет кнопки 'Следующая' или ошибка: {e}", flush=True)
                break
        save_products(products)
    except Exception as e:
        print(f"Error scraping {url}: {e}", flush=True)
    finally:
        driver.quit()

def save_products(products):
    if not products:
        return
    conn = get_db_connection()
    with conn.cursor() as cur:
        query = """
            INSERT INTO products (
                category_id, name, price, parsed_price, brand, rating, 
                reviews_count, installment_price, computed_revenue, image_url
            ) VALUES %s
        """
        extras.execute_values(cur, query, products)
        conn.commit()
    conn.close()

def main():
    print("Начало работы скрипта", flush=True)
    ensure_tables_exist()
    if not categories_exist():
        with open('categories_and_subcategories.txt', 'r', encoding='utf-8') as f:
            content = f.read()
        categories = parse_category_file(content)
        save_categories(categories)
    else:
        print("Категории уже сохранены, пропускаем парсинг категорий.", flush=True)

    conn = get_db_connection()
    with conn.cursor() as cur:
        cur.execute("SELECT id, url FROM categories WHERE url IS NOT NULL")
        categories_to_scrape = cur.fetchall()
    conn.close()
    print(f"Найдено категорий для скрапинга товаров: {len(categories_to_scrape)}", flush=True)
    with ThreadPoolExecutor(max_workers=15) as executor:
        for cat_id, url in categories_to_scrape:
            executor.submit(scrape_category, cat_id, url)

if __name__ == "__main__":
    main()
