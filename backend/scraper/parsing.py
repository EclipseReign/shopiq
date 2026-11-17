"""Pure parsers shared by migration, scraper, and regression tests."""

import re
from decimal import Decimal, InvalidOperation
from urllib.parse import urljoin, urlsplit, urlunsplit


def parse_price(text):
    if text is None:
        return None
    value = re.sub(r"[\s\u00a0\u202f]", "", str(text)).replace("₸", "")
    value = re.sub(r"(?:тг\.?|KZT)$", "", value, flags=re.I).replace(",", ".")
    if not re.fullmatch(r"\d+(?:\.\d{1,2})?", value):
        return None
    try:
        amount = Decimal(value)
        return amount if 0 < amount < Decimal("1000000000000") else None
    except InvalidOperation:
        return None


def parse_reviews(text):
    if text is None or not str(text).strip():
        return None
    text = str(text).lower()
    if "нет отзыв" in text or "без отзыв" in text:
        return 0
    match = re.search(r"(\d[\d\s\u00a0\u202f]*)\s*(?:отзыв|пікір)", text)
    if not match:
        match = re.fullmatch(r"\s*\(?([\d\s\u00a0\u202f]+)\)?\s*", text)
    return int(re.sub(r"\s", "", match.group(1))) if match else None


def parse_rating(class_name):
    match = re.search(r"(?:^|\s)(?:rating)?[_-](\d{1,2})(?=\s|$)", class_name or "")
    if not match:
        return None
    value = int(match.group(1)) / 10
    return value if 0 <= value <= 5 else None


def kaspi_url(value, kind=None):
    url = urlsplit(urljoin("https://kaspi.kz", value or ""))
    if (
        url.scheme != "https"
        or url.hostname != "kaspi.kz"
        or url.port not in (None, 443)
    ):
        raise ValueError("Разрешены ссылки https://kaspi.kz/shop/")
    prefix = f"/shop/{kind}/" if kind else "/shop/"
    if not url.path.startswith(prefix) or url.username or url.password:
        raise ValueError("Некорректная ссылка каталога Kaspi")
    return urlunsplit(("https", "kaspi.kz", url.path, "", ""))


def parse_category_file(content):
    categories, stack = [], []
    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line == "Все категории:":
            continue
        match = re.fullmatch(
            r"(?:Category:\s*|-> Subcategory:\s*)?(.+?)\s*\(([^)]+)\):?", line
        )
        if not match:
            raise ValueError(f"Не удалось прочитать категорию {line}")
        indent = len(raw_line) - len(raw_line.lstrip())
        raw_url = match.group(2).lstrip("/")
        if raw_url.startswith("c/"):
            raw_url = "shop/" + raw_url
        url = kaspi_url(raw_url if raw_url.startswith("https://") else "/" + raw_url)
        if not re.match(r"https://kaspi.kz/shop/(?:c|l)/", url) or re.search(
            r"\s", url
        ):
            raise ValueError(f"Некорректная ссылка категории {line}")
        while stack and stack[-1][0] >= indent:
            stack.pop()
        category = {
            "temp_id": len(categories) + 1,
            "name": match.group(1).strip(),
            "url": url,
            "parent_temp_id": stack[-1][1] if stack else None,
            "level": len(stack),
        }
        categories.append(category)
        stack.append((indent, category["temp_id"]))
    return categories
