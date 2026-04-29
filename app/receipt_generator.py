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


def draw_text_pilmoji(draw, img, xy, text, fill, font, emoji_font):
    """Рисует текст с эмодзи через Pilmoji"""
    with Pilmoji(img) as pilmoji:
        pilmoji.text(xy, text, fill=fill, font=font, emoji_scale_factor=1.0)


def draw_text_right_pilmoji(draw, img, x_right, y, text, fill, font, emoji_font):
    """Рисует текст с эмодзи, выровненный по правому краю"""
    tw = text_width(text, font)
    for c in text:
        if ord(c) > 127:
            tw += 4
    draw_text_pilmoji(draw, img, (x_right - tw, y), text, fill, font, emoji_font)


def draw_text_center_pilmoji(draw, img, x_center, y, text, fill, font, emoji_font):
    """Рисует текст с эмодзи по центру"""
    tw = text_width(text, font)
    for c in text:
        if ord(c) > 127:
            tw += 4
    draw_text_pilmoji(draw, img, (x_center - tw // 2, y), text, fill, font, emoji_font)


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
    
    # Emoji шрифт
    emoji_font = load_font("NotoColorEmoji-Regular.ttf", 24)

    # Высота
    items = 5
    for g in session_data["guests"]:
        items += 1 + len(g.get("items", [])) + 1
    H = max(400, P * 2 + 100 + items * LH)

    # Создаём изображение
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

    # 🍸 BAR CHECK
    draw_text_center_pilmoji(draw, img, W // 2, y, '🍸 BAR CHECK', '#f5c518', ft_title, emoji_font)
    y += 38

    # Барный учёт Pro
    draw_text_center_pilmoji(draw, img, W // 2, y, 'Барный учёт Pro', '#e94560', ft_h1, emoji_font)
    y += 26

    # Дата и номер
    date_str = session_data.get("date", "")
    draw_text_center_pilmoji(draw, img, W // 2, y, date_str, '#999999', ft_small, emoji_font)
    y += 20

    check_num = f'Чек № {session_data["session_id"][:8].upper()}'
    draw_text_center_pilmoji(draw, img, W // 2, y, check_num, '#999999', ft_small, emoji_font)
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

        # 👤 Имя (🏆 место)
        label = f'👤 {name}'
        if place:
            label += f'  🏆 {place} место'

        draw_text_pilmoji(draw, img, (P, y), label, '#e94560', ft_h2, emoji_font)
        
        total_label = f'{total} ₽'
        draw_text_right_pilmoji(draw, img, W - P, y, total_label, '#e94560', ft_h2, emoji_font)
        y += GH

        # Позиции
        for item in guest.get("items", []):
            item_name = item.get("name", "?")
            item_count = item.get("count", 1)
            item_total = item.get("total", 0)

            is_poker = 'Покер' in item_name or 'Poker' in item_name
            prefix = '  ♠️ ' if is_poker else '  🍹 '
            name_color = '#f5c518' if is_poker else '#cccccc'

            draw_text_pilmoji(draw, img, (P + 16, y), f'{prefix}{item_name}', name_color, ft_item, emoji_font)
            draw_text_center_pilmoji(draw, img, W // 2 + 40, y, f'×{item_count}', '#cccccc', ft_item, emoji_font)

            price_color = '#2ecc71' if item_total < 0 else '#cccccc'
            draw_text_right_pilmoji(draw, img, W - P, y, f'{item_total} ₽', price_color, ft_item, emoji_font)
            y += LH

        y += 4

    y += 4

    # Разделитель
    draw.line([(P, y), (W - P, y)], fill='#e94560', width=2)
    y += 26

    # 💸 ИТОГО
    grand = session_data.get("grand_total", 0)
    draw_text_pilmoji(draw, img, (P, y), '💸 ИТОГО:', '#f5c518', ft_total, emoji_font)
    draw_text_right_pilmoji(draw, img, W - P, y, f'{grand} ₽', '#f5c518', ft_total, emoji_font)
    y += 30

    # На N гостей
    guests_count = len(session_data.get("guests", []))
    draw_text_center_pilmoji(draw, img, W // 2, y, f'На {guests_count} гостей', '#999999', ft_small, emoji_font)
    y += 30

    # Footer
    draw_text_center_pilmoji(draw, img, W // 2, y, 'Спасибо за вечер! 🍸', '#666666', ft_footer, emoji_font)

    # Сохраняем
    output = io.BytesIO()
    img.save(output, format='PNG', quality=95)
    return output.getvalue()
