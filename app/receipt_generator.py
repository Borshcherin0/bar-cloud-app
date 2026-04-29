"""
Генератор чека на сервере (без браузера)
Использует Pillow с дефолтными шрифтами
"""

import io
import os
from PIL import Image, ImageDraw, ImageFont


def get_font(size: int, bold: bool = False, italic: bool = False) -> ImageFont.FreeTypeFont:
    """Загружает шрифт из нескольких возможных путей"""
    
    font_names = []
    
    if bold and italic:
        font_names = [
            "DejaVuSans-BoldOblique.ttf",
            "DejaVuSans-Bold.ttf",
        ]
    elif bold:
        font_names = [
            "DejaVuSans-Bold.ttf",
            "DejaVuSans.ttf",
        ]
    elif italic:
        font_names = [
            "DejaVuSans-Oblique.ttf",
            "DejaVuSans.ttf",
        ]
    else:
        font_names = [
            "DejaVuSans.ttf",
        ]
    
    # Возможные пути к шрифтам
    base_paths = [
        "/usr/share/fonts/truetype/dejavu/",
        "/usr/share/fonts/",
        "/usr/local/share/fonts/",
        "/opt/render/project/src/",
        "",
    ]
    
    for base in base_paths:
        for name in font_names:
            path = os.path.join(base, name) if base else name
            if os.path.exists(path):
                try:
                    return ImageFont.truetype(path, size)
                except:
                    pass
    
    # Если шрифт не найден — возвращаем дефолтный (работает на всех системах)
    print(f"⚠️ Шрифт не найден, использую дефолтный")
    return ImageFont.load_default()


def generate_receipt_png(session_data: dict) -> bytes:
    """
    Генерирует PNG-чек и возвращает байты изображения.
    """
    
    WIDTH = 600
    PADDING = 40
    LINE_HEIGHT = 28
    HEADER_HEIGHT = 36
    
    # Считаем высоту
    items_count = 6
    for guest in session_data["guests"]:
        items_count += 1
        items_count += len(guest["items"])
        items_count += 1
    items_count += 2
    
    HEIGHT = max(450, PADDING * 2 + 120 + items_count * LINE_HEIGHT)
    
    # Создаём изображение
    img = Image.new('RGB', (WIDTH, HEIGHT), '#1a1a2e')
    draw = ImageDraw.Draw(img)
    
    # Загружаем шрифты
    font_title = get_font(26, bold=True)
    font_h1 = get_font(15, bold=True)
    font_h2 = get_font(16, bold=True)
    font_normal = get_font(13)
    font_small = get_font(11)
    font_total = get_font(22, bold=True)
    font_italic = get_font(11, italic=True)
    
    # Рамки
    draw.rectangle([8, 8, WIDTH - 9, HEIGHT - 9], outline='#e94560', width=3)
    draw.rectangle([14, 14, WIDTH - 15, HEIGHT - 15], outline='#f5c518', width=1)
    
    y = PADDING + 20
    
    # Заголовок
    bbox = draw.textbbox((0, 0), '🍸 BAR CHECK', font=font_title)
    text_width = bbox[2] - bbox[0]
    draw.text(((WIDTH - text_width) // 2, y), '🍸 BAR CHECK', fill='#f5c518', font=font_title)
    y += 40
    
    bbox = draw.textbbox((0, 0), 'Барный учёт Pro', font=font_h1)
    text_width = bbox[2] - bbox[0]
    draw.text(((WIDTH - text_width) // 2, y), 'Барный учёт Pro', fill='#e94560', font=font_h1)
    y += 30
    
    # Дата и номер
    date_text = session_data.get("date", "")
    bbox = draw.textbbox((0, 0), date_text, font=font_small)
    text_width = bbox[2] - bbox[0]
    draw.text(((WIDTH - text_width) // 2, y), date_text, fill='#999999', font=font_small)
    y += 22
    
    check_num = f'Чек № {session_data["session_id"][:8].upper()}'
    bbox = draw.textbbox((0, 0), check_num, font=font_small)
    text_width = bbox[2] - bbox[0]
    draw.text(((WIDTH - text_width) // 2, y), check_num, fill='#999999', font=font_small)
    y += 30
    
    # Разделитель
    draw.line([(PADDING, y), (WIDTH - PADDING, y)], fill='#f5c518', width=1)
    y += 22
    
    # Гости
    for guest in session_data["guests"]:
        name = guest.get("name", "Неизвестный")
        total = guest.get("total", 0)
        place = guest.get("poker_place")
        
        guest_label = f'👤 {name}'
        if place:
            guest_label += f'  🏆 {place} место'
        
        total_label = f'{total} ₽'
        
        draw.text((PADDING, y), guest_label, fill='#e94560', font=font_h2)
        bbox = draw.textbbox((0, 0), total_label, font=font_h2)
        draw.text((WIDTH - PADDING - bbox[2] + bbox[0], y), total_label, fill='#e94560', font=font_h2)
        y += HEADER_HEIGHT
        
        # Позиции
        for item in guest.get("items", []):
            item_name = item.get("name", "?")
            item_count = item.get("count", 1)
            item_total = item.get("total", 0)
            
            # Цвет для покерных строк
            color = '#f5c518' if 'Покер' in item_name else '#cccccc'
            
            draw.text((PADDING + 16, y), f'🍹 {item_name}', fill=color, font=font_normal)
            
            count_text = f'×{item_count}'
            bbox = draw.textbbox((0, 0), count_text, font=font_normal)
            draw.text((WIDTH // 2 + 40 - (bbox[2] - bbox[0]) // 2, y), count_text, fill='#cccccc', font=font_normal)
            
            # Отрицательные суммы зелёным
            total_text = f'{item_total} ₽'
            price_color = '#2ecc71' if item_total < 0 else '#cccccc'
            bbox = draw.textbbox((0, 0), total_text, font=font_normal)
            draw.text((WIDTH - PADDING - bbox[2] + bbox[0], y), total_text, fill=price_color, font=font_normal)
            y += LINE_HEIGHT
        
        y += 4
    
    y += 6
    
    # Разделитель перед итогом
    draw.line([(PADDING, y), (WIDTH - PADDING, y)], fill='#e94560', width=2)
    y += 28
    
    # Общий итог
    grand_total = session_data.get("grand_total", 0)
    total_text = f'{grand_total} ₽'
    draw.text((PADDING, y), '💸 ИТОГО:', fill='#f5c518', font=font_total)
    bbox = draw.textbbox((0, 0), total_text, font=font_total)
    draw.text((WIDTH - PADDING - bbox[2] + bbox[0], y), total_text, fill='#f5c518', font=font_total)
    y += 32
    
    guests_count = len(session_data.get("guests", []))
    count_text = f'На {guests_count} гостей'
    bbox = draw.textbbox((0, 0), count_text, font=font_small)
    draw.text(((WIDTH - bbox[2] + bbox[0]) // 2, y), count_text, fill='#999999', font=font_small)
    y += 34
    
    # Footer
    footer = 'Спасибо за вечер! 🍸'
    bbox = draw.textbbox((0, 0), footer, font=font_italic)
    draw.text(((WIDTH - bbox[2] + bbox[0]) // 2, y), footer, fill='#666666', font=font_italic)
    
    # Сохраняем в байты
    output = io.BytesIO()
    img.save(output, format='PNG')
    return output.getvalue()
