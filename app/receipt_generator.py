"""
Генератор чека на сервере
Стильный минималистичный дизайн без эмодзи
"""

import io
import os
from PIL import Image, ImageDraw, ImageFont


def get_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    """Загружает шрифт из системы или использует дефолтный"""
    
    font_name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    
    # Пути поиска
    paths = [
        f"/usr/share/fonts/truetype/dejavu/{font_name}",
        f"/usr/share/fonts/truetype/liberation/{'LiberationSans-Bold.ttf' if bold else 'LiberationSans-Regular.ttf'}",
        f"/usr/share/fonts/{font_name}",
        font_name,
    ]
    
    for path in paths:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except:
                continue
    
    # Дефолтный шрифт Pillow
    return ImageFont.load_default()


def generate_receipt_png(session_data: dict) -> bytes:
    """Генерирует PNG-чек и возвращает байты изображения."""
    
    WIDTH = 620
    PADDING = 45
    LINE_HEIGHT = 30
    HEADER_HEIGHT = 38
    INNER_PADDING = 50
    
    # Считаем высоту
    items_count = 7
    for guest in session_data["guests"]:
        items_count += 1
        items_count += len(guest["items"])
        items_count += 1
    items_count += 3
    
    HEIGHT = max(500, 180 + items_count * LINE_HEIGHT)
    
    # Создаём изображение
    img = Image.new('RGB', (WIDTH, HEIGHT), '#0f0f1a')
    draw = ImageDraw.Draw(img)
    
    # Шрифты
    font_title = get_font(28, bold=True)
    font_subtitle = get_font(14, bold=True)
    font_guest = get_font(15, bold=True)
    font_item = get_font(13)
    font_small = get_font(11)
    font_total = get_font(22, bold=True)
    font_footer = get_font(11)
    
    # Цвета
    GOLD = '#f5c518'
    ACCENT = '#e94560'
    WHITE = '#e8e8e8'
    MUTED = '#888888'
    GREEN = '#4ade80'
    DARK_BG = '#1a1a2e'
    
    # Верхний блок
    draw.rectangle([0, 0, WIDTH, 130], fill=DARK_BG)
    
    # Тонкая линия сверху
    draw.rectangle([0, 0, WIDTH, 4], fill=ACCENT)
    
    y = 30
    
    # Логотип / Название
    title = 'BAR CHECK'
    bbox = draw.textbbox((0, 0), title, font=font_title)
    draw.text(((WIDTH - bbox[2] + bbox[0]) // 2, y), title, fill=GOLD, font=font_title)
    y += 38
    
    subtitle = 'Барный учёт Pro'
    bbox = draw.textbbox((0, 0), subtitle, font=font_subtitle)
    draw.text(((WIDTH - bbox[2] + bbox[0]) // 2, y), subtitle, fill=ACCENT, font=font_subtitle)
    y += 30
    
    # Дата и номер (в одной строке)
    date_text = session_data.get("date", "")
    check_num = f'№ {session_data["session_id"][:8].upper()}'
    
    info_text = f'{date_text}    |    {check_num}'
    bbox = draw.textbbox((0, 0), info_text, font=font_small)
    draw.text(((WIDTH - bbox[2] + bbox[0]) // 2, y), info_text, fill=MUTED, font=font_small)
    
    # Разделитель после шапки
    y = 135
    draw.line([(PADDING, y), (WIDTH - PADDING, y)], fill=GOLD, width=1)
    y += 30
    
    # Гости
    for guest in session_data["guests"]:
        name = guest.get("name", "Гость")
        total = guest.get("total", 0)
        place = guest.get("poker_place")
        
        # Имя гостя
        guest_label = name
        if place:
            guest_label += f'  [Poker: {place} место]'
        
        total_label = f'{total} P'
        
        draw.text((PADDING, y), guest_label, fill=ACCENT, font=font_guest)
        bbox = draw.textbbox((0, 0), total_label, font=font_guest)
        draw.text((WIDTH - PADDING - bbox[2] + bbox[0], y), total_label, fill=ACCENT, font=font_guest)
        
        # Подчёркивание имени
        line_y = y + HEADER_HEIGHT - 8
        draw.line([(PADDING, line_y), (PADDING + 80, line_y)], fill=ACCENT, width=1)
        
        y += HEADER_HEIGHT
        
        # Позиции
        for item in guest.get("items", []):
            item_name = item.get("name", "?")
            item_count = item.get("count", 1)
            item_total = item.get("total", 0)
            
            # Особое оформление для покера
            is_poker = 'Покер' in item_name or 'poker' in item_name.lower()
            color = GOLD if is_poker else WHITE
            
            # Название позиции
            draw.text((PADDING + INNER_PADDING, y), item_name, fill=color, font=font_item)
            
            # Количество
            count_text = f'x{item_count}'
            bbox = draw.textbbox((0, 0), count_text, font=font_item)
            draw.text((WIDTH // 2 + 20, y), count_text, fill=MUTED, font=font_item)
            
            # Сумма
            total_text = f'{item_total} P'
            price_color = GREEN if item_total < 0 else WHITE
            bbox = draw.textbbox((0, 0), total_text, font=font_item)
            draw.text((WIDTH - PADDING - bbox[2] + bbox[0], y), total_text, fill=price_color, font=font_item)
            
            # Тонкая линия между позициями
            y += LINE_HEIGHT
        
        # Итого по гостю
        if guest.get("items"):
            # Тонкий разделитель
            draw.line([(PADDING + INNER_PADDING, y - 2), (WIDTH - PADDING, y - 2)], fill='#333355', width=1)
        
        y += 6
    
    y += 10
    
    # Жирный разделитель перед общим итогом
    draw.line([(PADDING, y), (WIDTH - PADDING, y)], fill=ACCENT, width=2)
    y += 30
    
    # Общий итог
    grand_total = session_data.get("grand_total", 0)
    total_label = 'ИТОГО'
    total_value = f'{grand_total} P'
    
    bbox = draw.textbbox((0, 0), total_label, font=font_total)
    draw.text((PADDING, y), total_label, fill=GOLD, font=font_total)
    
    bbox = draw.textbbox((0, 0), total_value, font=font_total)
    draw.text((WIDTH - PADDING - bbox[2] + bbox[0], y), total_value, fill=GOLD, font=font_total)
    
    y += 34
    
    # Количество гостей
    guests_count = len(session_data.get("guests", []))
    count_text = f'{guests_count} гостей'
    bbox = draw.textbbox((0, 0), count_text, font=font_small)
    draw.text(((WIDTH - bbox[2] + bbox[0]) // 2, y), count_text, fill=MUTED, font=font_small)
    
    y += 36
    
    # Footer
    footer = 'Thank you & come again!'
    bbox = draw.textbbox((0, 0), footer, font=font_footer)
    draw.text(((WIDTH - bbox[2] + bbox[0]) // 2, y), footer, fill=MUTED, font=font_footer)
    
    # Тонкая линия внизу
    draw.rectangle([0, HEIGHT - 4, WIDTH, HEIGHT], fill=ACCENT)
    
    # Сохраняем
    output = io.BytesIO()
    img.save(output, format='PNG', quality=95)
    return output.getvalue()
