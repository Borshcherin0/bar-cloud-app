"""
Генератор чека на сервере
Использует шрифт Roboto из папки fonts/
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
    else:
        # Fallback на дефолтный
        return ImageFont.load_default()


def generate_receipt_png(session_data: dict) -> bytes:
    """Генерирует PNG-чек и возвращает байты изображения."""
    
    WIDTH = 620
    PADDING = 40
    LINE_HEIGHT = 26
    HEADER_HEIGHT = 34
    INNER_PADDING = 36
    
    # Загружаем шрифты
    font_title = load_font("Roboto-Bold.ttf", 24)
    font_subtitle = load_font("Roboto-Bold.ttf", 14)
    font_guest = load_font("Roboto-Bold.ttf", 15)
    font_item = load_font("Roboto-Regular.ttf", 13)
    font_small = load_font("Roboto-Regular.ttf", 11)
    font_total = load_font("Roboto-Bold.ttf", 20)
    
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
    BORDER = '#2a2d3e'
    
    # Верхний блок
    draw.rectangle([0, 0, WIDTH, 120], fill=DARK_BG)
    draw.rectangle([0, 0, WIDTH, 4], fill=RED)
    
    y = 28
    
    # Заголовок
    draw.text((PADDING, y), 'BAR CHECK', fill=GOLD, font=font_title)
    y += 32
    
    draw.text((PADDING, y), 'Bar Accounting System', fill=RED, font=font_subtitle)
    y += 24
    
    # Дата и номер
    date_text = session_data.get("date", "")
    check_num = session_data["session_id"][:8].upper()
    info = f'{date_text}    |    #{check_num}'
    draw.text((PADDING, y), info, fill=GRAY, font=font_small)
    
    # Разделитель
    y = 125
    draw.line([(PADDING, y), (WIDTH - PADDING, y)], fill=BORDER, width=1)
    y += 24
    
    # Гости
    for guest in session_data["guests"]:
        name = guest.get("name", "Guest")
        total = guest.get("total", 0)
        place = guest.get("poker_place")
        
        # Имя гостя
        guest_label = name
        if place:
            guest_label += f'  (Poker: {place} place)'
        
        total_label = f'{total} R'
        
        draw.text((PADDING, y), guest_label, fill=WHITE, font=font_guest)
        bbox = font_guest.getbbox(total_label)
        tw = bbox[2] - bbox[0]
        draw.text((WIDTH - PADDING - tw, y), total_label, fill=GOLD, font=font_guest)
        
        y += HEADER_HEIGHT
        
        # Позиции
        for item in guest.get("items", []):
            item_name = item.get("name", "?")
            item_count = item.get("count", 1)
            item_total = item.get("total", 0)
            
            # Особое оформление для покера
            is_poker = 'Poker' in item_name or 'poker' in item_name
            name_color = GOLD if is_poker else WHITE
            
            # Название
            draw.text((PADDING + INNER_PADDING, y), item_name, fill=name_color, font=font_item)
            
            # Количество
            count_text = f'x{item_count}'
            bbox = font_item.getbbox(count_text)
            tw = bbox[2] - bbox[0]
            draw.text((WIDTH // 2 + 20 - tw // 2, y), count_text, fill=GRAY, font=font_item)
            
            # Сумма
            total_text = f'{item_total} R'
            price_color = GREEN if item_total < 0 else GRAY
            bbox = font_item.getbbox(total_text)
            tw = bbox[2] - bbox[0]
            draw.text((WIDTH - PADDING - tw, y), total_text, fill=price_color, font=font_item)
            
            y += LINE_HEIGHT
        
        # Разделитель между гостями
        draw.line([(PADDING + INNER_PADDING, y - 2), (WIDTH - PADDING, y - 2)], fill='#1e2040', width=1)
        
        y += 8
    
    y += 8
    
    # Жирный разделитель
    draw.line([(PADDING, y), (WIDTH - PADDING, y)], fill=RED, width=2)
    y += 28
    
    # Общий итог
    grand_total = session_data.get("grand_total", 0)
    total_value = f'{grand_total} R'
    
    draw.text((PADDING, y), 'TOTAL', fill=GOLD, font=font_total)
    bbox = font_total.getbbox(total_value)
    tw = bbox[2] - bbox[0]
    draw.text((WIDTH - PADDING - tw, y), total_value, fill=GOLD, font=font_total)
    
    y += 32
    
    # Инфо
    guests_count = len(session_data.get("guests", []))
    draw.text((PADDING, y), f'{guests_count} guests', fill=GRAY, font=font_small)
    
    y += 30
    
    # Footer
    draw.text((PADDING, y), 'Thank you & come again!', fill=GRAY, font=font_small)
    
    # Нижняя линия
    draw.rectangle([0, HEIGHT - 3, WIDTH, HEIGHT], fill=RED)
    
    # Сохраняем
    output = io.BytesIO()
    img.save(output, format='PNG', quality=95)
    return output.getvalue()
