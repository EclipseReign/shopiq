"""Transactional, repeatable schema migration and bounded product upserts."""

import hashlib
import json
import os
import sqlite3
from contextlib import closing, contextmanager
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from parsing import parse_category_file, parse_price

ROOT = Path(__file__).resolve().parents[2]


def load_environment():
    # The SQLite setup only requires Python's standard library.
    for path in (
        ROOT / ".env",
        ROOT / "backend/.env",
        Path(__file__).with_name(".env"),
    ):
        if path.exists():
            for raw in path.read_text(encoding="utf-8-sig").splitlines():
                line = raw.strip()
                if line and not line.startswith("#") and "=" in line:
                    name, value = line.split("=", 1)
                    os.environ.setdefault(name.strip(), value.strip().strip("\"'"))


load_environment()


def database_path():
    path = Path(os.getenv("SHOPIQ_DB_PATH", "backend/data/shopiq.sqlite"))
    return path if path.is_absolute() else ROOT / path


class Database:
    def __init__(self):
        self.postgres = bool(os.getenv("DATABASE_URL"))
        if self.postgres:
            import psycopg2

            self.connection = psycopg2.connect(
                os.environ["DATABASE_URL"], connect_timeout=10
            )
        else:
            path = database_path()
            path.parent.mkdir(parents=True, exist_ok=True)
            self.connection = sqlite3.connect(path, timeout=30)
            self.connection.execute("PRAGMA journal_mode=WAL")
            self.connection.execute("PRAGMA foreign_keys=ON")

    def execute(self, sql, values=()):
        cursor = self.connection.cursor()
        cursor.execute(sql.replace("?", "%s") if self.postgres else sql, values)
        return cursor

    def columns(self, table):
        if self.postgres:
            return {
                row[0]
                for row in self.execute(
                    "SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=?",
                    (table,),
                ).fetchall()
            }
        return {
            row[1] for row in self.execute(f"PRAGMA table_info({table})").fetchall()
        }


@contextmanager
def connect():
    db = Database()
    try:
        yield db
        db.connection.commit()
    except BaseException:
        db.connection.rollback()
        raise
    finally:
        db.connection.close()


def product_key(category_id, name, external_id=None):
    if external_id:
        return f"kaspi:{external_id}"
    identity = f"{category_id}|{' '.join(name.lower().split())}"
    return "legacy:" + hashlib.sha256(identity.encode()).hexdigest()


def seed_categories(db):
    categories = parse_category_file(
        Path(__file__)
        .with_name("categories_and_subcategories.txt")
        .read_text(encoding="utf-8")
    )
    ids = {}
    for category in categories:
        parent = ids.get(category["parent_temp_id"])
        # Existing installations can have relative URLs.
        relative = category["url"].removeprefix("https://kaspi.kz")
        row = db.execute(
            "SELECT id FROM categories WHERE url IN (?, ?) ORDER BY id LIMIT 1",
            (category["url"], relative),
        ).fetchone()
        if row:
            ids[category["temp_id"]] = row[0]
        else:
            row = db.execute(
                "INSERT INTO categories(name,url,parent_id,level) VALUES(?,?,?,?) RETURNING id",
                (category["name"], category["url"], parent, category["level"]),
            ).fetchone()
            ids[category["temp_id"]] = row[0]


def initialize_catalog_schema(db):
    if db.execute("SELECT version FROM schema_migrations WHERE version=2").fetchone():
        return
    columns = db.columns("categories")
    for name, kind in {
        "source_code": "TEXT",
        "source_active": "INTEGER NOT NULL DEFAULT 0",
        "discovered_at": "TEXT",
    }.items():
        if name not in columns:
            db.execute(f"ALTER TABLE categories ADD COLUMN {name} {kind}")
    db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_code ON categories(source_code)")
    db.execute("""CREATE TABLE IF NOT EXISTS product_categories(
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        category_id INTEGER NOT NULL REFERENCES categories(id),
        PRIMARY KEY(product_id,category_id))""")
    db.execute("CREATE INDEX IF NOT EXISTS idx_product_categories_category ON product_categories(category_id,product_id)")
    db.execute("""INSERT INTO product_categories(product_id,category_id)
        SELECT id,category_id FROM products WHERE category_id IS NOT NULL
        ON CONFLICT(product_id,category_id) DO NOTHING""")
    db.execute("""CREATE TABLE IF NOT EXISTS product_city_prices(
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        city_id TEXT NOT NULL,parsed_price NUMERIC,scraped_at TIMESTAMP NOT NULL,
        PRIMARY KEY(product_id,city_id))""")
    db.execute("""INSERT INTO product_city_prices(product_id,city_id,parsed_price,scraped_at)
        SELECT id,city_id,parsed_price,scraped_at FROM products
        WHERE city_id IS NOT NULL AND parsed_price IS NOT NULL AND scraped_at IS NOT NULL
        ON CONFLICT(product_id,city_id) DO NOTHING""")
    primary = "SERIAL PRIMARY KEY" if db.postgres else "INTEGER PRIMARY KEY AUTOINCREMENT"
    db.execute(f"""CREATE TABLE IF NOT EXISTS price_history(
        id {primary},product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        city_id TEXT NOT NULL,parsed_price NUMERIC NOT NULL,scraped_at TIMESTAMP NOT NULL)""")
    db.execute("CREATE INDEX IF NOT EXISTS idx_price_history_product_city ON price_history(product_id,city_id,scraped_at)")
    db.execute("""CREATE TABLE IF NOT EXISTS catalog_discoveries(
        id TEXT PRIMARY KEY,city_id TEXT NOT NULL,status TEXT NOT NULL,
        started_at TEXT NOT NULL,finished_at TEXT,categories_count INTEGER,
        leaves_count INTEGER,error TEXT)""")
    db.execute("""CREATE TABLE IF NOT EXISTS catalog_tasks(
        run_id TEXT NOT NULL REFERENCES scraper_runs(id),category_id INTEGER NOT NULL REFERENCES categories(id),
        city_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',next_page INTEGER NOT NULL DEFAULT 0,
        expected_initial INTEGER,expected_latest INTEGER,page_size INTEGER,found_count INTEGER NOT NULL DEFAULT 0,
        invalid_count INTEGER NOT NULL DEFAULT 0,pages_done INTEGER NOT NULL DEFAULT 0,
        error TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(run_id,category_id))""")
    db.execute("""CREATE TABLE IF NOT EXISTS catalog_seen(
        run_id TEXT NOT NULL,category_id INTEGER NOT NULL,product_id INTEGER NOT NULL REFERENCES products(id),
        PRIMARY KEY(run_id,category_id,product_id),
        FOREIGN KEY(run_id,category_id) REFERENCES catalog_tasks(run_id,category_id))""")
    db.execute("""CREATE TABLE IF NOT EXISTS catalog_pages(
        run_id TEXT NOT NULL,category_id INTEGER NOT NULL,page INTEGER NOT NULL,signature TEXT NOT NULL,
        PRIMARY KEY(run_id,category_id,page),UNIQUE(run_id,category_id,signature),
        FOREIGN KEY(run_id,category_id) REFERENCES catalog_tasks(run_id,category_id))""")
    db.execute("CREATE INDEX IF NOT EXISTS idx_catalog_tasks_status ON catalog_tasks(run_id,status)")
    db.execute("INSERT INTO schema_migrations(version) VALUES(2)")


def initialize():
    if not os.getenv("DATABASE_URL"):
        target = database_path()
        original = ROOT / "kaspi.sqlite"
        if not target.exists() and original.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            # sqlite backup also works if the source happens to use WAL.
            with closing(sqlite3.connect(original)) as source, closing(
                sqlite3.connect(target)
            ) as destination:
                source.backup(destination)
    with connect() as db:
        if db.postgres:
            db.execute("SELECT pg_advisory_xact_lock(739821)")
        primary = (
            "SERIAL PRIMARY KEY" if db.postgres else "INTEGER PRIMARY KEY AUTOINCREMENT"
        )
        db.execute(
            f"CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY)"
        )
        if db.execute(
            "SELECT version FROM schema_migrations WHERE version=1"
        ).fetchone():
            initialize_catalog_schema(db)
            return
        db.execute(
            f"""CREATE TABLE IF NOT EXISTS categories (
            id {primary}, name TEXT NOT NULL, url TEXT,
            parent_id INTEGER REFERENCES categories(id), level INTEGER NOT NULL DEFAULT 0)"""
        )
        db.execute(f"CREATE TABLE IF NOT EXISTS products(id {primary})")
        additions = {
            "category_id": "INTEGER REFERENCES categories(id)",
            "category": "TEXT",
            "name": "TEXT",
            "price": "TEXT",
            "parsed_price": "NUMERIC",
            "brand": "TEXT",
            "rating": "NUMERIC",
            "reviews_count": "INTEGER",
            "installment_price": "TEXT",
            "computed_revenue": "NUMERIC",
            "image_url": "TEXT",
            "scraped_at": "TIMESTAMP",
            "product_key": "TEXT",
            "external_id": "TEXT",
            "product_url": "TEXT",
            "city_id": "TEXT",
        }
        columns = db.columns("products")
        for name, kind in additions.items():
            if name not in columns:
                db.execute(f"ALTER TABLE products ADD COLUMN {name} {kind}")
        seed_categories(db)
        names = {}
        for category_id, name in db.execute(
            "SELECT id,name FROM categories ORDER BY id"
        ).fetchall():
            names.setdefault(name, category_id)
        rows = db.execute(
            "SELECT id,category_id,category,name,price,parsed_price,external_id FROM products ORDER BY scraped_at DESC,id DESC"
        ).fetchall()
        seen = set()
        # Retain every pre-migration row for recovery and audit.
        db.execute(
            "CREATE TABLE IF NOT EXISTS products_before_v2 AS SELECT * FROM products"
        )
        for row_id, category_id, old_category, name, price, amount, external_id in rows:
            if not name:
                # Preserve incomplete historical records with a distinct identity.
                key = f"incomplete:{row_id}"
            else:
                if not category_id and old_category:
                    if old_category not in names:
                        names[old_category] = db.execute(
                            "INSERT INTO categories(name,level) VALUES(?,0) RETURNING id",
                            (old_category,),
                        ).fetchone()[0]
                    category_id = names[old_category]
                key = product_key(category_id, name, external_id)
            if key in seen:
                db.execute("DELETE FROM products WHERE id=?", (row_id,))
                continue
            seen.add(key)
            parsed = parse_price(price) if price else parse_price(amount)
            db.execute(
                "UPDATE products SET category_id=?,product_key=?,parsed_price=? WHERE id=?",
                (category_id, key, str(parsed) if parsed is not None else None, row_id),
            )
        db.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_products_key ON products(product_key)"
        )
        db.execute(
            "CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id)"
        )
        db.execute(
            "CREATE INDEX IF NOT EXISTS idx_products_category_date ON products(category_id,scraped_at)"
        )
        db.execute(
            "CREATE INDEX IF NOT EXISTS idx_products_price ON products(parsed_price,id)"
        )
        db.execute(
            "CREATE INDEX IF NOT EXISTS idx_products_date ON products(scraped_at,id)"
        )
        db.execute(
            """CREATE TABLE IF NOT EXISTS scraper_runs (
            id TEXT PRIMARY KEY, status TEXT NOT NULL, started_at TEXT NOT NULL,
            finished_at TEXT, options TEXT, progress TEXT, error TEXT)"""
        )
        db.execute("INSERT INTO schema_migrations(version) VALUES(1)")
        initialize_catalog_schema(db)


def save_products(products, city_id=None):
    if not products:
        return 0
    with connect() as db:
        for product in products:
            key = product_key(
                product["category_id"], product["name"], product.get("external_id")
            )
            # Match migrated rows on first observation to prevent duplicate legacy/live cards.
            if product.get("external_id"):
                legacy = product_key(product["category_id"], product["name"])
                existing = db.execute(
                    "SELECT id FROM products WHERE product_key=?", (key,)
                ).fetchone()
                if not existing:
                    db.execute(
                        "UPDATE products SET product_key=? WHERE product_key=?",
                        (key, legacy),
                    )
            columns = [
                "category_id",
                "name",
                "price",
                "parsed_price",
                "brand",
                "rating",
                "reviews_count",
                "image_url",
                "external_id",
                "product_url",
            ]
            values = [
                str(product.get(column)) if product.get(column) is not None else None
                for column in columns
            ]
            columns += ["product_key", "city_id", "scraped_at", "computed_revenue"]
            values += [
                key,
                city_id,
                datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
                None,
            ]
            updates = ",".join(
                f"{column}=excluded.{column}"
                for column in columns
                if column != "product_key"
            )
            db.execute(
                f"INSERT INTO products({','.join(columns)}) VALUES({','.join('?' for _ in columns)}) ON CONFLICT(product_key) DO UPDATE SET {updates}",
                values,
            )
            product_id = db.execute("SELECT id FROM products WHERE product_key=?", (key,)).fetchone()[0]
            db.execute(
                "INSERT INTO product_categories(product_id,category_id) VALUES(?,?) ON CONFLICT(product_id,category_id) DO NOTHING",
                (product_id, product["category_id"]),
            )
            if city_id:
                previous = db.execute(
                    "SELECT parsed_price FROM product_city_prices WHERE product_id=? AND city_id=?",
                    (product_id, city_id),
                ).fetchone()
                observed_at = values[-2]
                parsed_price = product.get("parsed_price")
                price_value = str(parsed_price) if parsed_price is not None else None
                changed = not previous or previous[0] is None or (
                    parsed_price is not None and Decimal(str(previous[0])) != Decimal(str(parsed_price))
                )
                if parsed_price is not None and changed:
                    db.execute(
                        "INSERT INTO price_history(product_id,city_id,parsed_price,scraped_at) VALUES(?,?,?,?)",
                        (product_id, city_id, price_value, observed_at),
                    )
                db.execute(
                    "INSERT INTO product_city_prices(product_id,city_id,parsed_price,scraped_at) VALUES(?,?,?,?) ON CONFLICT(product_id,city_id) DO UPDATE SET parsed_price=excluded.parsed_price,scraped_at=excluded.scraped_at",
                    (product_id, city_id, price_value, observed_at),
                )
    return len(products)


if __name__ == "__main__":
    initialize()
    with connect() as database:
        print(
            json.dumps(
                {
                    "database": (
                        "postgresql" if database.postgres else str(database_path())
                    ),
                    "products": database.execute(
                        "SELECT COUNT(*) FROM products"
                    ).fetchone()[0],
                },
                ensure_ascii=False,
            )
        )
