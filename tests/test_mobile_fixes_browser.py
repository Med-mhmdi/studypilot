import socket
import threading
import time
from pathlib import Path

import pytest

pytest.importorskip("playwright.sync_api")
from playwright.sync_api import expect, sync_playwright

from app.main import app


def test_mobile_message_actions_paste_and_task_touch_drag(tmp_path, monkeypatch):
    import uvicorn

    monkeypatch.setenv("DB_PATH", str(tmp_path / "mobile-fixes.db"))
    monkeypatch.setenv("SESSION_SECRET", "mobile-fixes-test-key")
    monkeypatch.setenv("COOKIE_SECURE", "false")
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    while port < 10000:
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    browser = None
    try:
        deadline = time.time() + 10
        while time.time() < deadline and not server.started:
            time.sleep(0.05)
        assert server.started
        with sync_playwright() as automation:
            chrome = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")
            browser = automation.chromium.launch(executable_path=str(chrome) if chrome.exists() else None)
            context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
            api = context.request
            response = api.post(f"{base}/api/auth/register", data={"email":"mobile@example.edu","username":"mobile","name":"Mobile Student","password":"study-together-123"})
            assert response.status == 201
            project = api.post(f"{base}/api/projects", data={"name":"Mobile touch group","description":"","avatar":"mint"}).json()
            for index in range(24):
                assert api.post(f"{base}/api/projects/{project['id']}/messages", data={"body":f"History message {index}"}).status == 201
            response = api.post(f"{base}/api/projects/{project['id']}/messages", data={"body":"Hold this message for actions"})
            assert response.status == 201
            task = api.post(f"{base}/api/tasks", data={"title":"Touch drag assignment","due_date":"2026-10-30","priority":"low"})
            assert task.status == 201
            for index in range(12):
                assert api.post(f"{base}/api/tasks", data={"title":f"Scroll card {index}","due_date":"2026-10-30"}).status == 201

            page = context.new_page()
            page.goto(f"{base}/#/messages")
            page.get_by_role("button", name="Mobile touch group", exact=False).click()
            touch = context.new_cdp_session(page)
            bubble = page.get_by_text("Hold this message for actions", exact=True)
            bubble.dispatch_event("pointerdown", {"pointerType":"touch","button":0,"clientX":160,"clientY":260})
            page.wait_for_timeout(560)
            bubble.dispatch_event("pointerup", {"pointerType":"touch","button":0,"clientX":160,"clientY":260})
            details = page.locator(".message-row").filter(has=bubble).locator(".message-menu")
            expect(details).to_have_attribute("open", "")
            popup = page.locator("body > .message-menu-items")
            assert popup.evaluate("el=>el.style.position") == "fixed"
            bounds = popup.evaluate("el=>{const r=el.getBoundingClientRect(),v=visualViewport;return {top:r.top,left:r.left,right:r.right,bottom:r.bottom,vtop:v.offsetTop,vleft:v.offsetLeft,vright:v.offsetLeft+v.width,vbottom:v.offsetTop+v.height,scroll:getComputedStyle(el).overflowY}}")
            assert bounds["top"] >= bounds["vtop"] and bounds["bottom"] <= bounds["vbottom"], bounds
            assert bounds["left"] >= bounds["vleft"] and bounds["right"] <= bounds["vright"]
            assert bounds["scroll"] == "auto"
            page.screenshot(path=str(Path(__file__).parents[1] / ".tmp" / "mobile-message-menu-390.png"), full_page=True)
            page.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('clipboard denied'))}});document.execCommand=(command)=>command==='copy'")
            page.get_by_role("button", name="Copy message", exact=True).click()
            expect(page.locator(".app-message")).to_have_text("Message copied.")
            page.locator(".message-menu summary").last.click()
            page.evaluate("document.execCommand=()=>false")
            page.get_by_role("button", name="Copy message", exact=True).click()
            expect(page.locator(".app-message")).to_contain_text("Could not copy")
            composer = page.get_by_role("textbox", name="Group message")
            assert composer.evaluate("el=>getComputedStyle(el).userSelect!=='none'")
            assert composer.evaluate("el=>{const e=new Event('contextmenu',{bubbles:true,cancelable:true});el.dispatchEvent(e);return e.defaultPrevented}") is False

            page.goto(f"{base}/#/board")
            card = page.locator(".task-card").filter(has_text="Touch drag assignment")
            handle = card.locator(".task-drag")
            lane_cards = page.locator('.kanban-lane[data-status="todo"] .lane-cards')
            assert lane_cards.evaluate("el=>el.scrollHeight>el.clientHeight")
            lane_box=lane_cards.bounding_box()
            touch_start={"x":lane_box["x"]+lane_box["width"]/2,"y":lane_box["y"]+lane_box["height"]-24}
            touch_end={"x":touch_start["x"],"y":touch_start["y"]-90}
            touch.send("Input.dispatchTouchEvent", {"type":"touchStart","touchPoints":[touch_start]})
            touch.send("Input.dispatchTouchEvent", {"type":"touchMove","touchPoints":[touch_end]})
            touch.send("Input.dispatchTouchEvent", {"type":"touchEnd","touchPoints":[]})
            page.wait_for_timeout(120)
            assert lane_cards.evaluate("el=>el.scrollTop>0")
            lane_cards.evaluate("el=>el.scrollTop=0")
            target = page.locator('.kanban-lane[data-status="in_progress"]')
            target_point = target.evaluate("el=>{const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}}")
            handle_box=handle.bounding_box()
            handle_point={"x":handle_box["x"]+handle_box["width"]/2,"y":handle_box["y"]+handle_box["height"]/2}
            handle.dispatch_event("pointerdown", {"pointerType":"touch","button":0,**handle_point})
            handle.dispatch_event("pointerup", {"pointerType":"touch","button":0,**handle_point})
            assert api.get(f"{base}/api/tasks/{task.json()['id']}").json()["status"] == "todo"
            handle.dispatch_event("pointerdown", {"pointerType":"touch","button":0,**handle_point})
            page.wait_for_timeout(380)
            page.evaluate("p=>document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'touch',clientX:p.x,clientY:p.y}))", target_point)
            page.evaluate("p=>document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'touch',clientX:p.x,clientY:p.y}))", target_point)
            expect(page.locator('.kanban-lane[data-status="in_progress"] .task-title')).to_have_text("Touch drag assignment", timeout=8000)
            assert api.get(f"{base}/api/tasks/{task.json()['id']}").json()["status"] == "in_progress"
            assert page.locator(".task-card").filter(has_text="Touch drag assignment").count() == 1
            page.locator('.kanban-lane[data-status="todo"] .lane-cards').evaluate("el=>el.scrollTop=0")
            page.wait_for_timeout(400)
            page.screenshot(path=str(Path(__file__).parents[1] / ".tmp" / "mobile-fixes-390.png"), full_page=True)
            for width in (360, 390, 414):
                page.set_viewport_size({"width":width,"height":844})
                assert page.locator("#task-board").evaluate("el=>el.scrollWidth<=el.clientWidth+1")
            for width in (1280, 1600):
                for theme in ("light", "dark"):
                    page.set_viewport_size({"width":width,"height":900})
                    page.evaluate("theme=>document.documentElement.dataset.theme=theme", theme)
                    assert page.locator(".task-badges-row").first.evaluate("el=>getComputedStyle(el).display") == "flex"
                    page.screenshot(path=str(Path(__file__).parents[1] / ".tmp" / f"mobile-fixes-{width}-{theme}.png"), full_page=True)
    finally:
        if browser:
            try:
                browser.close()
            except Exception:
                pass
        server.should_exit = True
        thread.join(timeout=5)
