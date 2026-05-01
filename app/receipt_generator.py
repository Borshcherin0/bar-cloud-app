"""
Генератор чека на сервере
Стиль Liquid Glass — полупрозрачные слои, градиенты, блики
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


def char_width(char: str, ft, fe) -> int:
    font = fe if is_emoji(char) else ft
    return font.getbbox(char)[2] - font.getbbox(char)[0]


def text_width(text: str, ft, fe) -> int:
    return sum(char_width(c, ft, fe) for c in text)


def draw_text(draw, xy, text, fill, ft, fe):
    x, y = xy
    for c in text:
        font = fe if is_emoji(c) else ft
        draw.text((x, y), c, fill=fill, font=font)
        x += char_width(c, ft, fe)


def draw_text_right(draw, x_right, y, text, fill, ft, fe):
    tw = text_width(text, ft, fe)
    draw_text(draw, (x_right - tw, y), text, fill, ft, fe)


def draw_text_center(draw, x_center, y, text, fill, ft, fe):
    tw = text_width(text, ft, fe)
    draw_text(draw, (x_center - tw // 2, y), text, fill, ft, fe)


def generate_receipt_png(session_data: dict) -> bytes:
    W = 640
    PADDING = 44
    CARD_PADDING = 20
    LINE_HEIGHT = 28
    GUEST_HEADER = 36
    CARD_RADIUS = 24

    # Шрифты
    ft_title = load_font("Roboto-Bold.ttf", 28)
    ft_subtitle = load_font("Roboto-Bold.ttf", 14)
    ft_guest = load_font("Roboto-Bold.ttf", 16)
    ft_item = load_font("Roboto-Regular.ttf", 13)
    ft_small = load_font("Roboto-Regular.ttf", 11)
    ft_total = load_font("Roboto-Bold.ttf", 22)
    ft_footer = load_font("Roboto-Regular.ttf", 10)

    fe_title = load_font("NotoColorEmoji-Regular.ttf", 26)
    fe_guest = load_font("NotoColorEmoji-Regular.ttf", 14)
    fe_item = load_font("NotoColorEmoji-Regular.ttf", 12)
    fe_small = load_font("NotoColorEmoji-Regular.ttf", 10)
    fe_total = load_font("NotoColorEmoji-Regular.ttf", 20)

    # Считаем высоту
    cards_count = 1 + len(session_data["guests"]) + 1  # хедер + гости + футер
    items_height = 0
    for g in session_data["guests"]:
        items_height += GUEST_HEADER + len(g.get("items", [])) * LINE_HEIGHT + 12

    H = 180 + items_height + cards_count * 40

    # Создаём изображение
    img = Image.new('RGB', (W, H), '#000000')
    draw = ImageDraw.Draw(img)

    # ===== ФОНОВЫЕ ГРАДИЕНТЫ =====
    for i in range(H):
        # Мягкие цветовые пятна
        r = int(10 + 15 * (i / H))
        g = int(10 + 15 * (i / H))
        b = int(15 + 20 * (i / H))
        draw.line([(0, i), (W, i)], fill=(r, g, b))

    # Цветовые сферы (vibrant)
    for cx, cy, cr, color in [
        (100, 80, 200, (10, 132, 255)),
        (W - 100, H // 2, 250, (191, 90, 242)),
        (W // 2, H - 100, 180, (255, 159, 10)),
    ]:
        for r in range(cr, 0, -2):
            alpha = int(15 * (1 - r / cr))
            clr = (color[0], color[1], color[2], alpha)
            draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=clr, outline=None)

    # ===== КАРТОЧКИ =====
    y = 60

    # Хедер (стеклянная карточка)
    header_height = 100
    draw_glass_card(draw, PADDING, y, W - 2 * PADDING, header_height, CARD_RADIUS)
    
    y += 30
    draw_text_center(draw, W // 2, y, '🍸 BAR CHECK', '#ffffff', ft_title, fe_title)
    y += 38
    draw_text_center(draw, W // 2, y, 'Барный учёт Pro', 'rgba(255,255,255,0.6)', ft_subtitle, fe_guest)
    y += 28
    draw_text_center(draw, W // 2, y, session_data.get("date", ""), 'rgba(255,255,255,0.4)', ft_small, fe_small)
    
    y = 60 + header_height + 24

    # Карточки гостей
    for guest in session_data["guests"]:
        name = guest.get("name", "Guest")
        total = guest.get("total", 0)
        place = guest.get("poker_place")
        items = guest.get("items", [])

        guest_height = GUEST_HEADER + len(items) * LINE_HEIGHT + 16
        
        draw_glass_card(draw, PADDING + 10, y, W - 2 * (PADDING + 10), guest_height, CARD_RADIUS - 4)
        
        inner_y = y + 14

        # Имя гостя
        label = f'👤 {name}'
        if place:
            label += f'  🏆 {place} место'
        draw_text(draw, (PADDING + CARD_PADDING + 10, inner_y), label, '#ffffff', ft_guest, fe_guest)

        total_label = f'{total} ₽'
        draw_text_right(draw, W - PADDING - CARD_PADDING - 10, inner_y, total_label, 'rgba(10,132,255,0.9)', ft_guest, fe_guest)
        inner_y += GUEST_HEADER

        # Позиции
        for item in items:
            item_name = item.get("name", "?")
            item_count = item.get("count", 1)
            item_total = item.get("total", 0)

            is_poker = 'Покер' in item_name or 'poker' in item_name.lower()
            prefix = '  ♠️ ' if is_poker else '  · '
            name_color = 'rgba(255,159,10,0.9)' if is_poker else 'rgba(255,255,255,0.7)'

            draw_text(draw, (PADDING + CARD_PADDING + 20, inner_y), f'{prefix}{item_name}', name_color, ft_item, fe_item)
            
            count_text = f'×{item_count}'
            draw_text_center(draw, W // 2 + 40, inner_y, count_text, 'rgba(255,255,255,0.4)', ft_item, fe_item)

            price_color = 'rgba(48,209,88,0.9)' if item_total < 0 else 'rgba(255,255,255,0.6)'
            draw_text_right(draw, W - PADDING - CARD_PADDING - 10, inner_y, f'{item_total} ₽', price_color, ft_item, fe_item)
            inner_y += LINE_HEIGHT

        y += guest_height + 16

    # Итоговая карточка
    total_height = 70
    draw_glass_card(draw, PADDING, y, W - 2 * PADDING, total_height, CARD_RADIUS, highlight=True)
    
    inner_y = y + 18
    grand_total = session_data.get("grand_total", 0)
    draw_text(draw, (PADDING + CARD_PADDING, inner_y), '💸 ИТОГО', 'rgba(255,255,255,0.8)', ft_total, fe_total)
    draw_text_right(draw, W - PADDING - CARD_PADDING, inner_y, f'{grand_total} ₽', '#ffffff', ft_total, fe_total)

    y += total_height + 30

    # Footer
    guests_count = len(session_data["guests"])
    draw_text_center(draw, W // 2, y, f'👥 {guests_count} гостей  •  Спасибо за вечер!', 'rgba(255,255,255,0.35)', ft_footer, fe_small)

    # Сохраняем
    output = io.BytesIO()
    img.save(output, format='PNG', quality=95)
    return output.getvalue()


def draw_glass_card(draw, x, y, w, h, radius, highlight=False):
    """Рисует стеклянную карточку Liquid Glass"""
    
    # Основной фон (полупрозрачный)
    for i in range(h):
        alpha = int(40 + 10 * (1 - abs(i - h/2) / (h/2)))
        draw.rounded_rectangle(
            [x, y + i, x + w, y + i + 1],
            radius=radius,
            fill=(28, 28, 30, min(255, alpha)),
            outline=None
        )

    # Граница
    draw.rounded_rectangle(
        [x, y, x + w, y + h],
        radius=radius,
        fill=None,
        outline='rgba(255,255,255,0.08)',
        width=1
    )

    # Стеклянный блик сверху
    if highlight:
        for i in range(3):
            alpha = 60 - i * 20
            draw.rounded_rectangle(
                [x + 2, y + i, x + w - 2, y + i + 1],
                radius=radius - i,
                fill=(255, 255, 255, max(0, alpha)),
                outline=None
            )
    else:
        draw.rounded_rectangle(
            [x + 2, y, x + w - 2, y + 1],
            radius=radius,
            fill=(255, 255, 255, 40),
            outline=None
        )

    # Тень
    for i in range(6):
        alpha = 15 - i * 2
        draw.rounded_rectangle(
            [x + 2, y + h + i, x + w - 2, y + h + i + 1],
            radius=radius,
            fill=(0, 0, 0, max(0, alpha)),
            outline=None
        )
