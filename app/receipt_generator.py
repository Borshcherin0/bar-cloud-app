"""
Генератор чека на сервере
Дизайн идентичен веб-версии с эмодзи
"""

import io
import os
from PIL import Image, ImageDraw, ImageFont

FONTS_DIR = os.path.join(os.path.dirname(__file__), "..", "fonts")


def load_font(name: str, size: int) -> ImageFont.FreeTypeFont:
    font_path = os.path.join(FONTS_DIR, name)
    if os.path.exists(font_path):
        return ImageFont.truetype(font_path, size)
    return ImageFont.load_default()


def is_emoji(char: str) -> bool:
    code = ord(char)
    return (
        0x1F000 <= code <= 0x1FFFF or
        0x2600 <= code <= 0x27BF or
        0x2300 <= code <= 0x23FF or
        code == 0x200D or code == 0xFE0F
    )


def char_width(char: str, ft, femoji) -> int:
    font = femoji if is_emoji(char) else ft
    bbox = font.getbbox(char)
    return bbox[2] - bbox[0]


def text_width(text: str, ft, femoji) -> int:
    return sum(char_width(c, ft, femoji) for c in text)


def draw_text(draw, xy, text, fill, ft, femoji):
    x, y = xy
    for c in text:
        font = femoji if is_emoji(c) else ft
        draw.text((x, y), c, fill=fill, font=font)
        x += char_width(c, ft, femoji)


def draw_text_right(draw, x_right, y, text, fill, ft, femoji):
    tw = text_width(text, ft, femoji)
    draw_text(draw, (x_right - tw, y), text, fill, ft, femoji)


def draw_text_center(draw, x_center, y, text, fill, ft, femoji):
    tw = text_width(text, ft, femoji)
    draw_text(draw, (x_center - tw // 2, y), text, fill, ft, femoji)


def generate_receipt_png(session_data: dict) -> bytes:
    W = 600
    P = 40
    LH = 26
    GH = 34

    ft_title = load_font("Roboto-Bold.ttf", 26)
    ft_h1 = load_font("Roboto-Bold.ttf", 15)
    ft_h2 = load_font("Roboto-Bold.ttf", 16)
    ft_item = load_font("Roboto-Regular.ttf", 13)
    ft_small = load_font("Roboto-Regular.ttf", 12)
    ft_total = load_font("Roboto-Bold.ttf", 20)
    ft_footer = load_font("Roboto-Regular.ttf", 11)

    fe_title = load_font("NotoColorEmoji-Regular.ttf", 24)
    fe_h = load_font("NotoColorEmoji-Regular.ttf", 14)
    fe_h2 = load_font("NotoColorEmoji-Regular.ttf", 15)
    fe_item = load_font("NotoColorEmoji-Regular.ttf", 12)
    fe_small = load_font("NotoColorEmoji-Regular.ttf", 11)
    fe_total = load_font("NotoColorEmoji-Regular.ttf", 18)

    items = 5
    for g in session_data["guests"]:
        items += 1 + len(g.get("items", [])) + 1
    H = max(400, P * 2 + 100 + items * LH)

    img = Image.new('RGB', (W, H), '#1a1a2e')
    draw = ImageDraw.Draw(img)

    for i in range(H):
        r = max(0, min(255, 26 - (i * 4 // H)))
        g = max(0, min(255, 26 + (i * 8 // H)))
        b = max(0, min(255, 46 + (i * 16 // H)))
        draw.line([(0, i), (W, i)], fill=(r, g, b))

    draw.rectangle([8, 8, W - 9, H - 9], outline='#e94560', width=3)
    draw.rectangle([14, 14, W - 15, H - 15], outline='#f5c518', width=1)

    y = P + 16

    draw_text_center(draw, W // 2, y, '🍸 BAR CHECK', '#f5c518', ft_title, fe_title)
    y += 38

    draw_text_center(draw, W // 2, y, 'Барный учёт Pro', '#e94560', ft_h1, fe_h)
    y += 26

    date_str = session_data.get("date", "")
    draw_text_center(draw, W // 2, y, date_str, '#999999', ft_small, fe_small)
    y += 20

    check_num = f'Чек № {session_data["session_id"][:8].upper()}'
    draw_text_center(draw, W // 2, y, check_num, '#999999', ft_small, fe_small)
    y += 30

    for x in range(P, W - P, 12):
        draw.line([(x, y), (x + 6, y)], fill='#f5c518', width=1)
    y += 20

    for guest in session_data["guests"]:
        name = guest.get("name", "?")
        total = guest.get("total", 0)
        place = guest.get("poker_place")

        label = f'👤 {name}'
        if place:
            label += f'  🏆 {place} место'

        draw_text(draw, (P, y), label, '#e94560', ft_h2, fe_h2)
        total_label = f'{total} ₽'
        draw_text_right(draw, W - P, y, total_label, '#e94560', ft_h2, fe_h2)
        y += GH

        for item in guest.get("items", []):
            item_name = item.get("name", "?")
            item_count = item.get("count", 1)
            item_total = item.get("total", 0)

            is_poker = 'Покер' in item_name or 'Poker' in item_name
            prefix = '  ♠️ ' if is_poker else '  🍹 '
            name_color = '#f5c518' if is_poker else '#cccccc'

            draw_text(draw, (P + 16, y), f'{prefix}{item_name}', name_color, ft_item, fe_item)
            draw_text_center(draw, W // 2 + 40, y, f'×{item_count}', '#cccccc', ft_item, fe_item)

            price_color = '#2ecc71' if item_total < 0 else '#cccccc'
            draw_text_right(draw, W - P, y, f'{item_total} ₽', price_color, ft_item, fe_item)
            y += LH

        y += 4

    y += 4

    draw.line([(P, y), (W - P, y)], fill='#e94560', width=2)
    y += 26

    grand = session_data.get("grand_total", 0)
    draw_text(draw, (P, y), '💸 ИТОГО:', '#f5c518', ft_total, fe_total)
    draw_text_right(draw, W - P, y, f'{grand} ₽', '#f5c518', ft_total, fe_total)
    y += 30

    guests_count = len(session_data.get("guests", []))
    draw_text_center(draw, W // 2, y, f'На {guests_count} гостей', '#999999', ft_small, fe_small)
    y += 30

    draw_text_center(draw, W // 2, y, 'Спасибо за вечер! 🍸', '#666666', ft_footer, fe_small)

    output = io.BytesIO()
    img.save(output, format='PNG', quality=95)
    return output.getvalue()
