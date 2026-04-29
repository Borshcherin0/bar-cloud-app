"""
Генератор чека на сервере
Работает без внешних шрифтов — использует Pillow default font
"""

import io
import struct
from PIL import Image, ImageDraw, ImageFont


def get_font(size: int) -> ImageFont.FreeTypeFont:
    """Возвращает дефолтный шрифт Pillow (всегда работает)"""
    return ImageFont.load_default()


def get_text_width(text: str, font: ImageFont.FreeTypeFont) -> int:
    """Измеряет ширину текста"""
    bbox = font.getbbox(text)
    return bbox[2] - bbox[0]


def generate_receipt_png(session_data: dict) -> bytes:
    """Генерирует PNG-чек и возвращает байты изображения."""
    
    WIDTH = 620
    PADDING = 40
    LINE_HEIGHT = 26
    HEADER_HEIGHT = 34
    INNER_PADDING = 36
    
    # Считаем высоту
    items_count = 7
    for guest in session_data["guests"]:
        items_count += 1
        items_count += len(guest["items"])
        items_count += 1
    items_count += 3
    
    HEIGHT = max(500, 160 + items_count * LINE_HEIGHT)
    
    # Создаём изображение
    img = Image.new('RGB', (WIDTH, HEIGHT), '#0f0f1a')
    draw = ImageDraw.Draw(img)
    
    # Шрифты (разные размеры дефолтного шрифта)
    font_big = get_font(18)
    font_mid = get_font(14)
    font_small = get_font(10)
    
    # Цвета
    GOLD = '#f5c518'
    RED = '#e94560'
    WHITE = '#e8e8e8'
    GRAY = '#888888'
    GREEN = '#4ade80'
    DARK = '#1a1a2e'
    
    # Верхняя плашка
    draw.rectangle([0, 0, WIDTH, 110], fill=DARK)
    draw.rectangle([0, 0, WIDTH, 3], fill=RED)
    
    y = 24
    
    # Заголовок
    title = 'BAR CHECK'
    draw.text((PADDING, y), title, fill=GOLD, font=font_big)
    y += 28
    
    draw.text((PADDING, y), 'Bar accounting system', fill=RED, font=font_small)
    y += 22
    
    # Дата и номер
    date_text = session_data.get("date", "")
    check_num = session_data["session_id"][:8].upper()
    draw.text((PADDING, y), f'{date_text}    |    #{check_num}', fill=GRAY, font=font_small)
    
    # Разделитель
    y = 115
    draw.line([(PADDING, y), (WIDTH - PADDING, y)], fill=GOLD, width=1)
    y += 24
    
    # Гости
    for guest in session_data["guests"]:
        name = guest.get("name", "Guest")
        total = guest.get("total", 0)
        place = guest.get("poker_place")
        
        # Имя гостя
        guest_label = name
        if place:
            guest_label += f' [Poker #{place}]'
        
        total_label = f'{total} R'
        
        draw.text((PADDING, y), guest_label, fill=RED, font=font_mid)
        tw = get_text_width(total_label, font_mid)
        draw.text((WIDTH - PADDING - tw, y), total_label, fill=RED, font=font_mid)
        
        # Подчёркивание
        line_y = y + HEADER_HEIGHT - 6
        draw.line([(PADDING, line_y), (PADDING + 60, line_y)], fill=RED, width=1)
        
        y += HEADER_HEIGHT
        
        # Позиции
        for item in guest.get("items", []):
            item_name = item.get("name", "?")
            item_count = item.get("count", 1)
            item_total = item.get("total", 0)
            
            # Особое оформление для покера
            is_poker = 'Poker' in item_name or 'POKER' in item_name
            color = GOLD if is_poker else WHITE
            
            # Название
            draw.text((PADDING + INNER_PADDING, y), item_name, fill=color, font=font_small)
            
            # Количество
            count_text = f'x{item_count}'
            tw = get_text_width(count_text, font_small)
            draw.text((WIDTH // 2 + 10, y), count_text, fill=GRAY, font=font_small)
            
            # Сумма
            total_text = f'{item_total} R'
            price_color = GREEN if item_total < 0 else WHITE
            tw = get_text_width(total_text, font_small)
            draw.text((WIDTH - PADDING - tw, y), total_text, fill=price_color, font=font_small)
            
            y += LINE_HEIGHT
        
        # Тонкий разделитель между позициями
        draw.line([(PADDING + INNER_PADDING, y - 2), (WIDTH - PADDING, y - 2)], fill='#2a2a4a', width=1)
        
        y += 8
    
    y += 8
    
    # Жирный разделитель
    draw.line([(PADDING, y), (WIDTH - PADDING, y)], fill=RED, width=2)
    y += 26
    
    # Итого
    grand_total = session_data.get("grand_total", 0)
    total_value = f'{grand_total} R'
    
    draw.text((PADDING, y), 'TOTAL', fill=GOLD, font=font_big)
    tw = get_text_width(total_value, font_big)
    draw.text((WIDTH - PADDING - tw, y), total_value, fill=GOLD, font=font_big)
    
    y += 30
    
    # Гостей
    guests_count = len(session_data.get("guests", []))
    draw.text((PADDING, y), f'{guests_count} guests', fill=GRAY, font=font_small)
    
    y += 32
    
    # Footer
    draw.text((PADDING, y), 'Thank you & come again!', fill=GRAY, font=font_small)
    
    # Нижняя плашка
    draw.rectangle([0, HEIGHT - 3, WIDTH, HEIGHT], fill=RED)
    
    # Сохраняем
    output = io.BytesIO()
    img.save(output, format='PNG')
    return output.getvalue()
