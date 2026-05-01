"""
Генератор чека на сервере
Использует Pilmoji для цветных эмодзи + Roboto для текста
"""

import io
import os
from PIL import Image, ImageDraw, ImageFont
from pilmoji import Pilmoji

FONTS_DIR = os.path.join(os.path.dirname(__file__), "..", "fonts")


def load_font(name: str, size: int) -> ImageFont.FreeTypeFont:
    font_path = os.path.join(FONTS_DIR, name)
    if os.path.exists(font_path):
        return ImageFont.truetype(font_path, size)
    return ImageFont.load_default()


def text_width(text: str, font: ImageFont.FreeTypeFont) -> int:
    return sum(font.getbbox(c)[2] - font.getbbox(c)[0] for c in text)


def generate_receipt_png(session_data: dict) -> bytes:
    W = 600
    P = 40
    LH = 26
    GH = 34

    # Шрифты
    ft_title = load_font("Roboto-Bold.ttf", 26)
    ft_h1 = load_font("Roboto-Bold.ttf", 15)
    ft_h2 = load_font("Roboto-Bold.ttf", 16)
    ft_item = load_font("Roboto-Regular.ttf", 13)
    ft_small = load_font("Roboto-Regular.ttf", 12)
    ft_total = load_font("Roboto-Bold.ttf", 20)
    ft_footer = load_font("Roboto-Regular.ttf", 11)

    # Emoji шрифт для Pilmoji
    emoji_font = load_font("NotoColorEmoji-Regular.ttf", 24)

    # Высота
    items = 5
    for g in session_data["guests"]:
        items += 1 + len(g.get("items", [])) + 1
    H = max(400, P * 2 + 100 + items * LH)

    img = Image.new('RGB', (W, H), '#1a1a2e')
    draw = ImageDraw.Draw(img)

    # Градиентный фон
    for i in range(H):
        r = max(0, min(255, 26 - (i * 4 // H)))
        g = max(0, min(255, 26 + (i * 8 // H)))
        b = max(0, min(255, 46 + (i * 16 // H)))
        draw.line([(0, i), (W, i)], fill=(r, g, b))

    # Двойная рамка
    draw.rectangle([8, 8, W - 9, H - 9], outline='#e94560', width=3)
    draw.rectangle([14, 14, W - 15, H - 15], outline='#f5c518', width=1)

    y = P + 16

    # Заголовок с эмодзи через Pilmoji
    with Pilmoji(img) as pilmoji:
        title = '🍸 BAR CHECK'
        tw = text_width(title, ft_title) + 20  # +20 на эмодзи
        pilmoji.text((W // 2 - tw // 2, y), title, fill='#f5c518', font=ft_title, emoji_scale_factor=1.0)
    y += 38

    # Подзаголовок
    with Pilmoji(img) as pilmoji:
        sub = 'Барный учёт Pro'
        tw = text_width(sub, ft_h1)
        pilmoji.text((W // 2 - tw // 2, y), sub, fill='#e94560', font=ft_h1)
    y += 26

    # Дата
    date_str = session_data.get("date", "")
    tw = text_width(date_str, ft_small)
    draw.text((W // 2 - tw // 2, y), date_str, fill='#999999', font=ft_small)
    y += 20

    # Номер
    check_num = f'Чек № {session_data["session_id"][:8].upper()}'
    tw = text_width(check_num, ft_small)
    draw.text((W // 2 - tw // 2, y), check_num, fill='#999999', font=ft_small)
    y += 30

    # Пунктир
    for x in range(P, W - P, 12):
        draw.line([(x, y), (x + 6, y)], fill='#f5c518', width=1)
    y += 20

    # Гости
    for guest in session_data["guests"]:
        name = guest.get("name", "?")
        total = guest.get("total", 0)
        place = guest.get("poker_place")

        # Имя гостя с эмодзи
        label = f'👤 {name}'
        if place:
            label += f'  🏆 {place} место'

        with Pilmoji(img) as pilmoji:
            pilmoji.text((P, y), label, fill='#e94560', font=ft_h2, emoji_scale_factor=1.0)

        total_label = f'{total} ₽'
        tw = text_width(total_label, ft_h2)
        draw.text((W - P - tw, y), total_label, fill='#e94560', font=ft_h2)
        y += GH

        # Позиции
        for item in guest.get("items", []):
            item_name = item.get("name", "?")
            item_count = item.get("count", 1)
            item_total = item.get("total", 0)

            is_poker = 'Покер' in item_name or 'Poker' in item_name
            prefix = '♠️ ' if is_poker else '🍹 '
            name_color = '#f5c518' if is_poker else '#cccccc'

            full_name = f'  {prefix}{item_name}'
            with Pilmoji(img) as pilmoji:
                pilmoji.text((P + 16, y), full_name, fill=name_color, font=ft_item, emoji_scale_factor=1.0)

            count_text = f'×{item_count}'
            tw = text_width(count_text, ft_item)
            draw.text((W // 2 + 40 - tw // 2, y), count_text, fill='#cccccc', font=ft_item)

            price_color = '#2ecc71' if item_total < 0 else '#cccccc'
            total_text = f'{item_total} ₽'
            tw = text_width(total_text, ft_item)
            draw.text((W - P - tw, y), total_text, fill=price_color, font=ft_item)
            y += LH

        y += 4

    y += 4

    # Разделитель
    draw.line([(P, y), (W - P, y)], fill='#e94560', width=2)
    y += 26

    # Итого с эмодзи
    grand = session_data.get("grand_total", 0)
    with Pilmoji(img) as pilmoji:
        pilmoji.text((P, y), '💸 ИТОГО:', fill='#f5c518', font=ft_total, emoji_scale_factor=1.0)
    total_text = f'{grand} ₽'
    tw = text_width(total_text, ft_total)
    draw.text((W - P - tw, y), total_text, fill='#f5c518', font=ft_total)
    y += 30

    # На N гостей
    guests_count = len(session_data.get("guests", []))
    tw = text_width(f'На {guests_count} гостей', ft_small)
    draw.text((W // 2 - tw // 2, y), f'На {guests_count} гостей', fill='#999999', font=ft_small)
    y += 30

    # Footer с эмодзи
    with Pilmoji(img) as pilmoji:
        footer = 'Спасибо за вечер! 🍸'
        tw = text_width(footer, ft_footer) + 10
        pilmoji.text((W // 2 - tw // 2, y), footer, fill='#666666', font=ft_footer)

    output = io.BytesIO()
    img.save(output, format='PNG', quality=95)
    return output.getvalue()
