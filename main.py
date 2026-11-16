import os
import uvicorn
from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles


from app.guests import router as guests_router
from app.drinks import router as drinks_router
from app.sessions import router as sessions_router
from app.orders import router as orders_router
from app.bill import router as bill_router
from app.poker import router as poker_router
from app.analytics import router as analytics_router
from app.health import router as health_router
from app.telegram import router as telegram_router
from app.ingredients import router as ingredients_router
from app.inventory import router as inventory_router
from app.events import router as events_router
from app.tournaments import require_session, router as tournaments_router


app = FastAPI(title="Барный учёт API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def require_admin_api(request: Request):
    route = (request.method, request.url.path.rstrip("/"))
    if route in {
        ("GET", "/api/events"),
        ("GET", "/api/events/ical"),
        ("POST", "/api/sessions/close-external"),  # Uses the shortcut API key.
    }:
        return
    if route in {("GET", "/api/drinks"), ("GET", "/api/inventory/report")}:
        if request.query_params.get("menu_only") == "true":
            return
    require_session(request)


# Подключаем роутеры
app.include_router(guests_router, dependencies=[Depends(require_admin_api)])
app.include_router(drinks_router, dependencies=[Depends(require_admin_api)])
app.include_router(sessions_router, dependencies=[Depends(require_admin_api)])
app.include_router(orders_router, dependencies=[Depends(require_admin_api)])
app.include_router(bill_router, dependencies=[Depends(require_admin_api)])
app.include_router(poker_router, dependencies=[Depends(require_admin_api)])
app.include_router(analytics_router, dependencies=[Depends(require_admin_api)])
app.include_router(health_router)
app.include_router(telegram_router, dependencies=[Depends(require_admin_api)])
app.include_router(ingredients_router, dependencies=[Depends(require_admin_api)])
app.include_router(inventory_router, dependencies=[Depends(require_admin_api)])
app.include_router(events_router, dependencies=[Depends(require_admin_api)])
app.include_router(tournaments_router)


# Статика
if os.path.exists("static"):
    app.mount("/static", StaticFiles(directory="static", html=False), name="static")


@app.get("/", response_class=HTMLResponse)
def serve_frontend():
    paths = ["index.html", "static/index.html"]
    for path in paths:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return f.read()
    return HTMLResponse("<h1>index.html не найден</h1>", status_code=404)


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    print(f"🚀 Барный учёт запущен на порту {port}")
    uvicorn.run(app, host="0.0.0.0", port=port)


@app.get("/menu", response_class=HTMLResponse)
def guest_menu():
    if os.path.exists("guest_menu.html"):
        with open("guest_menu.html", "r", encoding="utf-8") as f:
            return f.read()
    return HTMLResponse("<h1>Меню не найдено</h1>", status_code=404)

