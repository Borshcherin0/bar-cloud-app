"""
Генератор чека на сервере (без браузера)
Использует Pillow для создания PNG
"""

import io
from PIL import Image, ImageDraw, ImageFont


def generate_receipt_png(session_data: dict) -> bytes:
    """
    Генерирует PNG-чек и возвращает байты изображения.
    
    session_data = {
        "session_id": str,
        "date": str,
        "guests": [
            {
                "name": str,
                "total": int,
                "poker_place": int | None,
                "items": [
                    {"name": str, "count": int, "price": int, "total": int}
                ]
            }
        ],
        "grand_total": int,
    }
    """
    
    WIDTH = 600
    PADDING = 40
    LINE_HEIGHT = 26
    HEADER_HEIGHT = 34
    
    # Считаем высоту
    items_count = 6  # заголовок, дата, номер, разделители
    for guest in session_data["guests"]:
        items_count += 1  # имя гостя
        items_count += len(guest["items"])  # позиции
        items_count += 1  # итог гостя
    items_count += 2  # общий итог и footer
    
    HEIGHT = max(400, PADDING * 2 + 100 + items_count * LINE_HEIGHT)
    
    # Создаём изображение
    img = Image.new('RGB', (WIDTH, HEIGHT), '#1a1a2e')
    draw = ImageDraw.Draw(img)
    
    # Пытаемся загрузить шрифт
    try:
        font_title = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 26)
        font_h1 = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 15)
        font_h2 = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 16)
        font_normal = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 13)
        font_small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 12)
        font_total = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 20)
        font_italic = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf", 11)
    except:
        # Если шрифт не найден — используем дефолтный
        font_title = ImageFont.load_default()
        font_h1 = ImageFont.load_default()
        font_h2 = ImageFont.load_default()
        font_normal = ImageFont.load_default()
        font_small = ImageFont.load_default()
        font_total = ImageFont.load_default()
        font_italic = ImageFont.load_default()
    
    # Рамки
    draw.rectangle([8, 8, WIDTH - 9, HEIGHT - 9], outline='#e94560', width=3)
    draw.rectangle([14, 14, WIDTH - 15, HEIGHT - 15], outline='#f5c518', width=1)
    
    y = PADDING + 16
    
    # Заголовок
    draw.text((WIDTH // 2, y), '🍸 BAR CHECK', fill='#f5c518', font=font_title, anchor='mt')
    y += 38
    
    draw.text((WIDTH // 2, y), 'Барный учёт Pro', fill='#e94560', font=font_h1, anchor='mt')
    y += 28
    
    # Дата и номер
    draw.text((WIDTH // 2, y), session_data["date"], fill='#999999', font=font_small, anchor='mt')
    y += 20
    draw.text((WIDTH // 2, y), f'Чек № {session_data["session_id"][:8].upper()}', fill='#999999', font=font_small, anchor='mt')
    y += 28
    
    # Разделитель
    draw.line([(PADDING, y), (WIDTH - PADDING, y)], fill='#f5c518', width=1)
    y += 20
    
    # Гости
    for guest in session_data["guests"]:
        name = guest["name"]
        total = guest["total"]
        place = guest.get("poker_place")
        
        guest_label = f'👤 {name}'
        if place:
            guest_label += f'  🏆 {place} место'
        
        draw.text((PADDING, y), guest_label, fill='#e94560', font=font_h2, anchor='lt')
        draw.text((WIDTH - PADDING, y), f'{total} ₽', fill='#e94560', font=font_h2, anchor='rt')
        y += HEADER_HEIGHT
        
        # Позиции
        for item in guest["items"]:
            item_name = item["name"]
            
            # Цвет для покерных строк
            if 'Покер' in item_name:
                color = '#f5c518'
            else:
                color = '#cccccc'
            
            draw.text((PADDING + 14, y), f'  🍹 {item_name}', fill=color, font=font_normal, anchor='lt')
            draw.text((WIDTH // 2 + 30, y), f'×{item["count"]}', fill='#cccccc', font=font_normal, anchor='mt')
            
            # Отрицательные суммы зелёным
            item_total = item["total"]
            price_color = '#2ecc71' if item_total < 0 else '#cccccc'
            draw.text((WIDTH - PADDING, y), f'{item_total} ₽', fill=price_color, font=font_normal, anchor='rt')
            y += LINE_HEIGHT
        
        y += 4
    
    y += 4
    
    # Разделитель перед итогом
    draw.line([(PADDING, y), (WIDTH - PADDING, y)], fill='#e94560', width=2)
    y += 26
    
    # Общий итог
    grand_total = session_data["grand_total"]
    draw.text((PADDING, y), '💸 ИТОГО:', fill='#f5c518', font=font_total, anchor='lt')
    draw.text((WIDTH - PADDING, y), f'{grand_total} ₽', fill='#f5c518', font=font_total, anchor='rt')
    y += 30
    
    draw.text((WIDTH // 2, y), f'На {len(session_data["guests"])} гостей', fill='#999999', font=font_small, anchor='mt')
    y += 32
    
    # Footer
    draw.text((WIDTH // 2, y), 'Спасибо за вечер! 🍸', fill='#666666', font=font_italic, anchor='mt')
    
    # Сохраняем в байты
    output = io.BytesIO()
    img.save(output, format='PNG')
    return output.getvalue()
