"""
Генератор чека на сервере
Шрифты: Roboto для текста + NotoColorEmoji для эмодзи
"""

import io
import os
from PIL import Image, ImageDraw, ImageFont

# Путь к папке со шрифтами
FONTS_DIR = os.path.join(os.path.dirname(__file__), "..", "fonts")


def load_font(name: str, size: int) -> ImageFont.FreeTypeFont:
    """Загружает шрифт из папки fonts/"""
    font_path = os.path.join(FONTS_DIR, name)
    if os.path.exists(font_path):
        return ImageFont.truetype(font_path, size)
    print(f"Шрифт не найден: {font_path}")
    return ImageFont.load_default()


def is_emoji(char: str) -> bool:
    """Проверяет, является ли символ эмодзи"""
    code = ord(char)
    return (
        0x1F000 <= code <= 0x1FFFF or
        0x2600 <= code <= 0x27BF or
        0x2300 <= code <= 0x23FF or
        0x2B50 <= code <= 0x2B55 or
        0x2702 <= code <= 0x27B0 or
        code == 0x200D or
        code == 0xFE0F or
        code == 0x20E3
    )


def get_char_width(char: str, font_text, font_emoji) -> int:
    """Возвращает ширину символа с правильным шрифтом"""
    font = font_emoji if is_emoji(char) else font_text
    bbox = font.getbbox(char)
    return bbox[2] - bbox[0]


def measure_text(text: str, font_text, font_emoji) -> int:
    """Измеряет общую ширину текста с учётом эмодзи"""
    width = 0
    for char in text:
        width += get_char_width(char, font_text, font_emoji)
    return width


def draw_text_mixed(draw, xy, text, fill, font_text, font_emoji):
    """Рисует текст, используя font_emoji для эмодзи и font_text для остального"""
    x, y = xy
    for char in text:
        font = font_emoji if is_emoji(char) else font_text
        draw.text((x, y), char, fill=fill, font=font)
        x += get_char_width(char, font_text, font_emoji)


def draw_text_right(draw, x_right, y, text, fill, font_text, font_emoji):
    """Рисует текст, выровненный по правому краю"""
    total_width = measure_text(text, font_text, font_emoji)
    draw_text_mixed(draw, (x_right - total_width, y), text, fill, font_text, font_emoji)


def draw_text_center(draw, x_center, y, text, fill, font_text, font_emoji):
    """Рисует текст по центру"""
    total_width = measure_text(text, font_text, font_emoji)
    draw_text_mixed(draw, (x_center - total_width // 2, y), text, fill, font_text, font_emoji)


def generate_receipt_png(session_data: dict) -> bytes:
    """Генерирует PNG-чек и возвращает байты изображения."""
    
    WIDTH = 620
    PADDING = 40
    LINE_HEIGHT = 28
    HEADER_HEIGHT = 36
    INNER_PADDING = 36
    
    # Загружаем шрифты
    font_title = load_font("Roboto-Bold.ttf", 24)
    font_subtitle = load_font("Roboto-Bold.ttf", 14)
    font_guest = load_font("Roboto-Bold.ttf", 15)
    font_item = load_font("Roboto-Regular.ttf", 13)
    font_small = load_font("Roboto-Regular.ttf", 11)
    font_total = load_font("Roboto-Bold.ttf", 20)
    
    # Emoji шрифт (размеры чуть меньше, т.к. эмодзи крупнее)
    font_emoji_title = load_font("NotoColorEmoji-Regular.ttf", 22)
    font_emoji_guest = load_font("NotoColorEmoji-Regular.ttf", 14)
    font_emoji_item = load_font("NotoColorEmoji-Regular.ttf", 12)
    font_emoji_small = load_font("NotoColorEmoji-Regular.ttf", 10)
    font_emoji_total = load_font("NotoColorEmoji-Regular.ttf", 18)
    
    # Считаем высоту
    items_count = 7
    for guest in session_data["guests"]:
        items_count += 1
        items_count += len(guest["items"])
        items_count += 1
    items_count += 3
    
    HEIGHT = max(500, 160 + items_count * LINE_HEIGHT)
    
    # Создаём изображение
    img = Image.new('RGB', (WIDTH, HEIGHT), '#0f1119')
    draw = ImageDraw.Draw(img)
    
    # Цвета
    GOLD = '#f0c040'
    RED = '#e94560'
    WHITE = '#e8e8e8'
    GRAY = '#888899'
    GREEN = '#4ade80'
    DARK_BG = '#1a1d2e'
    
    # Верхний блок
    draw.rectangle([0, 0, WIDTH, 125], fill=DARK_BG)
    draw.rectangle([0, 0, WIDTH, 4], fill=RED)
    
    y = 30
    
    # Заголовок с эмодзи
    draw_text_mixed(draw, (PADDING, y), '🍸 BAR CHECK', GOLD, font_title, font_emoji_title)
    y += 36
    
    draw.text((PADDING, y), 'Bar Accounting System', fill=RED, font=font_subtitle)
    y += 26
    
    # Дата и номер
    date_text = session_data.get("date", "")
    check_num = session_data["session_id"][:8].upper()
    draw.text((PADDING, y), f'{date_text}    |    #{check_num}', fill=GRAY, font=font_small)
    
    # Разделитель
    y = 130
    draw.line([(PADDING, y), (WIDTH - PADDING, y)], fill='#2a2d3e', width=1)
    y += 26
    
    # Гости
    guests_data = session_data.get("guests", [])
    
    for guest in guests_data:
        name = guest.get("name", "Guest")
        total = guest.get("total", 0)
        place = guest.get("poker_place")
        
        # Имя гостя
        guest_label = f'👤 {name}'
        if place:
            guest_label += f'  🏆 {place} место'
        
        total_label = f'{total} ₽'
        
        draw_text_mixed(draw, (PADDING, y), guest_label, WHITE, font_guest, font_emoji_guest)
        draw_text_right(draw, WIDTH - PADDING, y, total_label, GOLD, font_guest, font_emoji_guest)
        
        y += HEADER_HEIGHT
        
        # Позиции гостя
        for item in guest.get("items", []):
            item_name = item.get("name", "?")
            item_count = item.get("count", 1)
            item_total = item.get("total", 0)
            
            # Покер выделяем
            is_poker = 'Покер' in item_name or 'Poker' in item_name
            name_color = GOLD if is_poker else WHITE
            prefix = '♠️ ' if is_poker else '· '
            
            draw_text_mixed(draw, (PADDING + INNER_PADDING, y), prefix + item_name, name_color, font_item, font_emoji_item)
            
            # Количество
            count_text = f'×{item_count}'
            tw = font_item.getbbox(count_text)[2] - font_item.getbbox(count_text)[0]
            draw.text((WIDTH // 2 + 20 - tw // 2, y), count_text, fill=GRAY, font=font_item)
            
            # Сумма
            total_text = f'{item_total} ₽'
            price_color = GREEN if item_total < 0 else GRAY
            draw_text_right(draw, WIDTH - PADDING, y, total_text, price_color, font_item, font_emoji_item)
            
            y += LINE_HEIGHT
        
        # Разделитель между гостями
        if guest != guests_data[-1]:
            draw.line([(PADDING + INNER_PADDING, y - 2), (WIDTH - PADDING, y - 2)], fill='#1e2040', width=1)
        
        y += 10
    
    y += 6
    
    # Жирный разделитель перед итогом
    draw.line([(PADDING, y), (WIDTH - PADDING, y)], fill=RED, width=2)
    y += 30
    
    # Общий итог
    grand_total = session_data.get("grand_total", 0)
    total_value = f'{grand_total} ₽'
    
    draw_text_mixed(draw, (PADDING, y), '💸 ИТОГО', GOLD, font_total, font_emoji_total)
    draw_text_right(draw, WIDTH - PADDING, y, total_value, GOLD, font_total, font_emoji_total)
    
    y += 36
    
    # Информация
    guests_count = len(guests_data)
    info_text = f'👥 {guests_count} гостей'
    draw_text_mixed(draw, (PADDING, y), info_text, GRAY, font_small, font_emoji_small)
    
    y += 32
    
    # Footer
    draw_text_mixed(draw, (PADDING, y), '🍸 Спасибо за вечер! Приходите ещё!', GRAY, font_small, font_emoji_small)
    
    # Нижняя линия
    draw.rectangle([0, HEIGHT - 3, WIDTH, HEIGHT], fill=RED)
    
    # Сохраняем
    output = io.BytesIO()
    img.save(output, format='PNG', quality=95)
    return output.getvalue()
