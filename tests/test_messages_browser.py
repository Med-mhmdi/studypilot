import re
import socket
import threading
import time
from pathlib import Path

import pytest

playwright = pytest.importorskip("playwright.sync_api")
from playwright.sync_api import expect, sync_playwright

from app.main import app


def _free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _ok(response):
    assert response.ok, response.text()


def _wait_for_server(server, base_url):
    import urllib.request

    deadline = time.time() + 10
    while time.time() < deadline and not server.started:
        time.sleep(0.05)
    if not server.started:
        raise RuntimeError("StudyPilot test server did not start")
    with urllib.request.urlopen(f"{base_url}/health", timeout=3) as response:
        assert response.status == 200


def test_messages_browser_group_direct_reply_unread_and_responsive(tmp_path, monkeypatch):
    import uvicorn

    monkeypatch.setenv("DB_PATH", str(tmp_path / "browser-messages.db"))
    monkeypatch.setenv("SESSION_SECRET", "browser-test-signing-key-not-for-hosting")
    monkeypatch.setenv("COOKIE_SECURE", "false")
    port = _free_port()
    base_url = f"http://127.0.0.1:{port}"
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    browser = None
    try:
        _wait_for_server(server, base_url)
        with sync_playwright() as automation:
            launch_options = {}
            installed_chrome = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")
            if installed_chrome.exists():
                launch_options["executable_path"] = str(installed_chrome)
            browser = automation.chromium.launch(**launch_options)
            owner = browser.new_context(viewport={"width": 1280, "height": 900})
            mate = browser.new_context(viewport={"width": 1280, "height": 900})
            _ok(owner.request.post(f"{base_url}/api/auth/register", data={"email": "owner@example.edu", "username": "owner", "name": "Owner", "password": "study-together-123"}))
            _ok(mate.request.post(f"{base_url}/api/auth/register", data={"email": "mate@example.edu", "username": "mate", "name": "Mate", "password": "study-together-123"}))
            project = owner.request.post(f"{base_url}/api/projects", data={"name": "Leaf crew", "description": "", "avatar": "mint"}).json()
            code = owner.request.get(f"{base_url}/api/projects/{project['id']}").json()["join_code"]
            _ok(mate.request.post(f"{base_url}/api/projects/join-requests", data={"code": code}))
            pending = owner.request.get(f"{base_url}/api/projects/{project['id']}/join-requests").json()[0]
            _ok(owner.request.post(f"{base_url}/api/projects/{project['id']}/join-requests/{pending['id']}/approve"))
            _ok(mate.request.post(f"{base_url}/api/projects/{project['id']}/messages", data={"body": "Hi from Mate"}))
            direct = owner.request.post(f"{base_url}/api/direct/conversations", data={"recipient_id": 2}).json()

            page = owner.new_page()
            page.goto(f"{base_url}/#/messages")
            expect(page.locator("#conversation-tab-groups")).to_have_attribute("aria-selected", "true")
            expect(page.locator("#conversation-tab-groups .tab-unread")).to_have_text("1 unread")
            expect(page.locator(".conversation-item")).to_have_count(1)
            expect(page.locator(".conversation-item .group-avatar")).to_have_class("avatar group-avatar group-avatar-mint")
            page.get_by_role("button", name="Leaf crew", exact=False).click()
            expect(page.locator("#conversation-tab-groups .tab-unread")).to_have_count(0)
            composer = page.get_by_role("textbox", name="Group message")
            expect(composer).to_have_attribute("autocomplete", "off")
            counter = composer.locator("xpath=following-sibling::*[contains(@class,'character-counter')]")
            expect(counter).to_have_text("0/2000")
            centers = page.evaluate("() => ['.direct-form input','.direct-form .character-counter','.direct-form button'].map(sel => { const r=document.querySelector(sel).getBoundingClientRect(); return r.top+r.height/2 })")
            assert max(centers) - min(centers) <= 2
            search = page.get_by_role("searchbox", name="Search conversations")
            search.focus()
            focus = page.locator(".inbox-search")
            assert page.evaluate("el => getComputedStyle(el).boxShadow", focus.element_handle()) != "none"
            expect(search).to_be_focused()

            def fail_group_send(route):
                route.abort()

            page.route(f"{base_url}/api/projects/{project['id']}/messages", fail_group_send)
            composer.fill("Keep group draft")
            page.get_by_role("button", name="Send").click()
            expect(composer).to_have_value("Keep group draft")
            page.unroute(f"{base_url}/api/projects/{project['id']}/messages", fail_group_send)
            composer.fill("")
            page.evaluate("showMessage('')")

            composer.fill("Hi")
            page.get_by_role("button", name="Send").click()
            expect(page.locator(".message-bubble").last).to_have_text("Hi")
            expect(composer).to_have_value("")
            expect(composer.locator("xpath=following-sibling::*[contains(@class,'character-counter')]")).to_have_text("0/2000")
            bubble = page.locator(".message-bubble").last
            assert page.evaluate("el => el.scrollHeight <= el.clientHeight + 1", bubble.element_handle())
            assert page.evaluate("el => { const r=document.createRange();r.selectNodeContents(el);return r.getClientRects().length===1; }", bubble.element_handle())
            for short_text in ("wassup", "are you ok"):
                composer.fill(short_text)
                page.get_by_role("button", name="Send").click()
                short_bubble = page.locator(".message-bubble").last
                expect(short_bubble).to_have_text(short_text)
                assert page.evaluate("el => { const r=document.createRange();r.selectNodeContents(el);return r.getClientRects().length===1; }", short_bubble.element_handle())
            composer.fill("x" * 1600)
            page.get_by_role("button", name="Send").click()
            long_bubble = page.locator(".message-bubble").last
            expect(long_bubble).to_have_text("x" * 1600)
            assert page.evaluate("el => el.scrollWidth <= el.clientWidth + 1", long_bubble.element_handle())
            assert page.evaluate("el => el.getBoundingClientRect().width <= 520", long_bubble.element_handle())

            own_message = page.locator(".message-row").filter(has=page.get_by_text("Hi", exact=True)).last
            original_id = own_message.get_attribute("data-message-id")
            own_message.locator(".message-menu summary").click()
            page.wait_for_timeout(4500)
            expect(own_message.locator(".message-menu-items")).to_be_visible()
            page.get_by_role("button", name="Pin message", exact=True).click()
            pinned_message = page.locator(f'.message-row[data-message-id="{original_id}"]')
            expect(pinned_message).to_have_class(re.compile(r"\bis-pinned\b"))
            expect(pinned_message.locator(".pinned-marker")).to_be_visible()
            expect(pinned_message).not_to_contain_text("Pinned")
            assert "inset" in pinned_message.locator(".message-bubble").evaluate("el => getComputedStyle(el).boxShadow")
            pinned_message.get_by_role("button", name="Unpin message").click()
            expect(pinned_message).not_to_have_class(re.compile(r"\bis-pinned\b"))
            own_message = page.locator(f'.message-row[data-message-id="{original_id}"]')
            own_message.locator(".message-menu summary").click()
            page.get_by_role("button", name="Reply", exact=True).click()
            expect(page.locator(".reply-preview")).to_be_visible()
            composer.fill("A reply")
            page.get_by_role("button", name="Send").click()
            expect(page.locator(".message-reply-quote").last).to_have_text("Hi")
            page.locator(".message-reply-quote").last.click()
            expect(page.locator(f'.message-row[data-message-id="{original_id}"]')).to_be_visible()
            _ok(owner.request.delete(f"{base_url}/api/projects/{project['id']}/messages/{original_id}"))
            page.reload()
            expect(page.locator(".message-reply-quote").last).to_have_text("Original message deleted")

            # An incoming message while the reader is at the top must preserve their position.
            for index in range(35):
                _ok(owner.request.post(f"{base_url}/api/projects/{project['id']}/messages", data={"body": f"History item {index}"}))
            page.reload()
            page.get_by_role("button", name="Leaf crew", exact=False).click()
            stream = page.locator("#direct-stream")
            stream.evaluate("el => { el.scrollTop = 0 }")
            prior_top = stream.evaluate("el => el.scrollTop")
            mate_page = mate.new_page()
            mate_page.goto(f"{base_url}/#/messages")
            mate_page.get_by_role("button", name="Leaf crew", exact=False).click()
            mate_page.get_by_role("textbox", name="Group message").fill("A new incoming message")
            mate_page.get_by_role("button", name="Send").click()
            expect(mate_page.locator(".message-bubble").last).to_have_text("A new incoming message")
            incoming_row = page.locator(".message-row.incoming").last
            avatar_top = incoming_row.locator(".message-avatar").evaluate("el => el.getBoundingClientRect().top")
            content_top = incoming_row.locator(".message-content").evaluate("el => el.getBoundingClientRect().top")
            assert abs(avatar_top - content_top) <= 1
            expect(stream.get_by_role("button", name="Jump to latest message")).to_be_visible(timeout=8000)
            expect(page.get_by_text("A new incoming message", exact=True)).to_be_visible()
            expect(stream.locator(".new-messages-divider")).to_be_visible()
            assert stream.evaluate("el => el.scrollTop") == prior_top
            stream.get_by_role("button", name="Jump to latest message").click()
            expect(stream.get_by_role("button", name="Jump to latest message")).to_have_count(0)
            expect(stream.locator(".new-messages-divider")).to_be_visible()
            stream.evaluate("el => { const row=el.querySelector('.message-row:last-of-type');el.scrollTop=el.scrollHeight-el.clientHeight-row.getBoundingClientRect().height/2; }")
            expect(stream.get_by_role("button", name="Jump to latest message")).to_be_visible()
            stream.evaluate("el => el.scrollTop=el.scrollHeight")
            expect(stream.get_by_role("button", name="Jump to latest message")).to_have_count(0)
            expect(stream.locator(".new-messages-divider")).to_be_visible()

            # Direct scope and messages remain separate and searchable within their selected tab.
            page.locator("#conversation-tab-direct").click()
            expect(page.locator(".conversation-item")).to_have_count(1)
            expect(page.locator(".conversation-item")).not_to_contain_text("Leaf crew")
            page.locator("#conversation-search").fill("owner")
            expect(page.locator(".conversation-item")).to_have_count(0)
            page.locator("#conversation-search").fill("")
            page.locator(".conversation-item").click()
            expect(page.get_by_role("textbox", name="Private message")).to_be_visible()
            page.get_by_role("textbox", name="Private message").fill("Direct hello")
            page.get_by_role("button", name="Send").click()
            expect(page.locator(".message-bubble").last).to_have_text("Direct hello")
            direct_row = page.locator(".message-row").filter(has=page.get_by_text("Direct hello", exact=True)).last
            direct_row.locator(".message-menu summary").click()
            page.get_by_role("button", name="Reply", exact=True).click()
            expect(page.locator(".reply-preview")).to_be_visible()
            page.get_by_role("textbox", name="Private message").fill("Direct reply")
            page.get_by_role("button", name="Send").click()
            expect(page.locator(".message-reply-quote").last).to_have_text("Direct hello")
            page.locator("#conversation-tab-direct").click()
            expect(page.locator(".conversation-item").first).to_contain_text("You: Direct reply")
            page.locator(".conversation-item").click()

            # A second logged-in browser receives direct messages, previews, unread counts, and notifications without revisiting the inbox.
            mate_page = mate.new_page()
            mate_page.goto(f"{base_url}/#/messages")
            mate_page.locator("#conversation-tab-direct").click()
            mate_page.locator(".conversation-item").click()
            mate_composer = mate_page.get_by_role("textbox", name="Private message")
            mate_composer.fill("Live direct from Mate")
            mate_page.get_by_role("button", name="Send").click()
            expect(page.locator("#direct-stream .message-bubble").filter(has_text="Live direct from Mate")).to_be_visible(timeout=9000)
            page.locator("#conversation-tab-direct").click()
            expect(page.locator(".conversation-item").first).to_contain_text("Live direct from Mate")
            expect(page.locator(".conversation-item").first.locator(".unread-pill")).to_have_count(0)
            page.locator("#notification-button").click()
            expect(page.locator("#notification-tabs")).to_contain_text("Messages")
            page.get_by_role("tab", name="Messages", exact=False).click()
            expect(page.get_by_text("You received a new message from Mate", exact=True)).to_be_visible()
            page.get_by_label("Select notification from Mate").first.check()
            page.get_by_role("button", name="Delete selected").click()
            expect(page.locator("#action-confirm-dialog")).to_be_visible()
            expect(page.locator("#action-confirm-dialog .confirm-message")).to_contain_text("1 selected notification")
            page.locator("#action-confirm-dialog").get_by_role("button", name="Cancel").click()
            expect(page.get_by_text("You received a new message from Mate", exact=True)).to_be_visible()
            page.get_by_role("button", name="Delete selected").click()
            page.locator("#action-confirm-dialog").get_by_role("button", name="Delete 1").click()
            expect(page.get_by_text("You received a new message from Mate", exact=True)).to_have_count(0)
            page.get_by_role("tab", name="Other", exact=False).click()
            if page.locator(".notification-item").count():
                page.get_by_role("button", name="Clear all").click()
                expect(page.locator("#action-confirm-dialog")).to_be_visible()
                page.locator("#action-confirm-dialog").get_by_role("button", name="Cancel").click()
                expect(page.locator(".notification-item").first).to_be_visible()
            page.locator("#notifications-dialog").get_by_role("button", name="Close").click()

            # A direct unread batch establishes a fresh divider with older context, and scroll alone does not dismiss it.
            page.goto(f"{base_url}/#/dashboard")
            mate_composer.fill("Unread direct batch one")
            mate_page.get_by_role("button", name="Send").click()
            expect(mate_page.locator("#direct-stream .message-bubble").last).to_have_text("Unread direct batch one")
            mate_composer.fill("Unread direct batch two")
            mate_page.get_by_role("button", name="Send").click()
            expect(mate_page.locator("#direct-stream .message-bubble").last).to_have_text("Unread direct batch two")
            expect(page.locator("#message-count")).to_be_visible(timeout=9000)
            expect(page.locator("#message-count")).to_have_text("3")
            page.goto(f"{base_url}/#/messages")
            expect(page.locator(".new-messages-divider")).to_be_visible()
            divider = page.locator(".new-messages-divider")
            visible_before = page.locator(".message-row").evaluate_all("(rows, d) => rows.filter(row => row.compareDocumentPosition(d[0]) & Node.DOCUMENT_POSITION_FOLLOWING).filter(row => { const r=row.getBoundingClientRect(),s=document.querySelector('.direct-stream').getBoundingClientRect();return r.top>=s.top&&r.bottom<=s.bottom; }).length", [divider.element_handle()])
            assert visible_before >= 2
            page.locator("#direct-stream").evaluate("el => el.scrollTop=el.scrollHeight")
            expect(page.locator(".new-messages-divider")).to_be_visible()
            for short_text in ("Direct hello", "Unread direct batch two"):
                short_bubble = page.locator("#direct-stream .message-bubble").filter(has_text=short_text).last
                assert page.evaluate("el => { const r=document.createRange();r.selectNodeContents(el);return r.getClientRects().length===1; }", short_bubble.element_handle())
            page.get_by_role("textbox", name="Private message").fill("Typing dismisses divider")
            expect(page.locator(".new-messages-divider")).to_have_count(0)

            def fail_direct_send(route):
                route.abort()

            page.route(f"{base_url}/api/direct/conversations/*/messages", fail_direct_send)
            private_composer = page.get_by_role("textbox", name="Private message")
            private_composer.fill("Keep this if send fails")
            page.get_by_role("button", name="Send").click()
            expect(private_composer).to_have_value("Keep this if send fails")
            page.unroute(f"{base_url}/api/direct/conversations/*/messages", fail_direct_send)
            private_composer.fill("")
            page.evaluate("showMessage('')")

            # Save visual checks at common desktop and phone widths and both themes.
            screenshot_dir = tmp_path / "screenshots"
            screenshot_dir.mkdir()
            page.evaluate("document.activeElement.blur(); document.querySelector('#app-message').hidden = true")
            for width, theme in ((1280, "light"), (1280, "dark"), (1600, "light"), (1600, "dark"), (390, "light"), (390, "dark")):
                page.set_viewport_size({"width": width, "height": 900})
                page.evaluate("([theme]) => document.documentElement.dataset.theme = theme", [theme])
                page.screenshot(path=str(screenshot_dir / f"messages-{width}-{theme}.png"), full_page=True)
            assert direct["id"]
    finally:
        server.should_exit = True
        thread.join(timeout=5)
