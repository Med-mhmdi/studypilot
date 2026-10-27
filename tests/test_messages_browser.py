import os
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
            project = owner.request.post(f"{base_url}/api/projects", data={"name": "Leaf crew notification wrapping test", "description": "", "avatar": "mint"}).json()
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
            assert page.evaluate("el => { const r=document.createRange();r.selectNodeContents(el);return r.getBoundingClientRect().height<=parseFloat(getComputedStyle(el).lineHeight)+1; }", bubble.element_handle())
            for short_text in ("wassup", "are you ok"):
                composer.fill(short_text)
                page.get_by_role("button", name="Send").click()
                short_bubble = page.locator(".message-bubble").last
                expect(short_bubble).to_have_text(short_text)
                assert page.evaluate("el => { const r=document.createRange();r.selectNodeContents(el);return r.getBoundingClientRect().height<=parseFloat(getComputedStyle(el).lineHeight)+1; }", short_bubble.element_handle())
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

            # Editing a group message on its sender's independent session updates the open recipient DOM in place.
            owner_composer = page.get_by_role("textbox", name="Group message")
            owner_composer.fill("Keep this group draft")
            recipient_group_row = page.locator(".message-row").filter(has_text="A new incoming message").last
            recipient_group_message_id = recipient_group_row.get_attribute("data-message-id")
            recipient_group_row = page.locator(f'.message-row[data-message-id="{recipient_group_message_id}"]')
            recipient_group_row.locator(".message-menu summary").click()
            expect(recipient_group_row.locator(".message-menu-items")).to_be_visible()
            owner_edit_scroll = stream.evaluate("el => el.scrollTop")
            sender_group_row = mate_page.locator(".message-row").filter(has_text="A new incoming message").last
            sender_group_message_id = sender_group_row.get_attribute("data-message-id")
            sender_group_row = mate_page.locator(f'.message-row[data-message-id="{sender_group_message_id}"]')
            sender_group_row.locator(".message-menu summary").click()
            mate_page.get_by_role("button", name="Edit message", exact=True).click()
            edit_dialog = mate_page.locator("#text-input-dialog")
            expect(edit_dialog).to_be_visible()
            edit_dialog.locator("textarea").fill("A group message edited live")
            edit_dialog.get_by_role("button", name="Save").click()
            expect(recipient_group_row.locator(".message-bubble")).to_have_text("A group message edited live", timeout=9000)
            expect(recipient_group_row.locator(".message-meta")).to_contain_text("edited")
            expect(recipient_group_row.locator(".message-menu-items")).to_be_visible()
            assert stream.evaluate("el => el.scrollTop") == owner_edit_scroll
            expect(owner_composer).to_have_value("Keep this group draft")
            page.keyboard.press("Escape")
            recipient_group_row.locator(".message-menu summary").click()
            page.get_by_role("button", name="Pin message", exact=True).click()
            expect(mate_page.locator(f'.message-row[data-message-id="{sender_group_message_id}"] .pinned-marker')).to_be_visible(timeout=9000)
            page.locator(f'.message-row[data-message-id="{sender_group_message_id}"] .message-menu summary').click()
            page.locator(f'.message-row[data-message-id="{sender_group_message_id}"] .message-menu-items').get_by_role("button", name="Unpin message", exact=True).click()
            expect(mate_page.locator(f'.message-row[data-message-id="{sender_group_message_id}"] .pinned-marker')).to_have_count(0, timeout=9000)

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
            owner_direct_composer = page.get_by_role("textbox", name="Private message")
            owner_direct_composer.fill("Keep this direct draft")
            direct_recipient_row = page.locator(".message-row").filter(has_text="Live direct from Mate").last
            direct_message_id = direct_recipient_row.get_attribute("data-message-id")
            direct_recipient_row = page.locator(f'.message-row[data-message-id="{direct_message_id}"]')
            direct_recipient_row.locator(".message-menu summary").click()
            expect(direct_recipient_row.locator(".message-menu-items")).to_be_visible()
            direct_sender_row = mate_page.locator(".message-row").filter(has_text="Live direct from Mate").last
            direct_message_id = direct_sender_row.get_attribute("data-message-id")
            direct_sender_row = mate_page.locator(f'.message-row[data-message-id="{direct_message_id}"]')
            direct_sender_row.locator(".message-menu summary").click()
            mate_page.get_by_role("button", name="Edit message", exact=True).click()
            edit_dialog = mate_page.locator("#text-input-dialog")
            expect(edit_dialog).to_be_visible()
            edit_dialog.locator("textarea").fill("Live direct edited by Mate")
            edit_dialog.get_by_role("button", name="Save").click()
            expect(direct_recipient_row.locator(".message-bubble")).to_have_text("Live direct edited by Mate", timeout=9000)
            expect(direct_recipient_row.locator(".message-meta")).to_contain_text("edited")
            expect(direct_recipient_row.locator(".message-menu-items")).to_be_visible()
            expect(owner_direct_composer).to_have_value("Keep this direct draft")
            # A block replaces the entire composer in both independent sessions; a fresh accepted request restores it live.
            inbox_height_before=page.locator(".inbox").evaluate("el=>el.getBoundingClientRect().height")
            assert owner.request.post(f"{base_url}/api/people/2/block").ok
            owner_status=page.locator(".direct-composer-status")
            mate_status=mate_page.locator(".direct-composer-status")
            expect(owner_status).to_contain_text("You blocked this classmate",timeout=10000)
            expect(mate_status).to_contain_text("Messaging is unavailable with this classmate",timeout=10000)
            expect(page.locator(".direct-block-status")).to_be_hidden()
            expect(owner_direct_composer).to_be_hidden()
            expect(page.locator(".direct-form .character-counter")).to_be_hidden()
            expect(page.locator(".direct-form").get_by_role("button",name="Send")).to_be_hidden()
            expect(page.locator("#direct-stream .message-row")).not_to_have_count(0)
            assert page.locator(".inbox").evaluate("el=>el.getBoundingClientRect().height")==inbox_height_before
            assert page.locator(".direct-composer-status").evaluate("el=>{const a=el.getBoundingClientRect(),f=el.parentElement.getBoundingClientRect();return Math.abs((a.top+a.height/2)-(f.top+f.height/2))<2}")
            page.set_viewport_size({"width":390,"height":844})
            assert page.locator(".direct-composer-status").evaluate("el=>el.scrollWidth<=el.clientWidth+1")
            page.set_viewport_size({"width":1280,"height":900})
            owner_status.get_by_role("button",name="Unblock this classmate").click()
            expect(owner_status).to_contain_text("Add this classmate to resume messaging")
            expect(mate_status).to_contain_text("Add this classmate to resume messaging",timeout=10000)
            assert mate.request.post(f"{base_url}/api/friend-requests",data={"username":"owner"}).ok
            incoming=owner.request.get(f"{base_url}/api/friend-requests").json()
            request_id=next(row["id"] for row in incoming if row["direction"]=="incoming" and row["status"]=="pending")
            assert owner.request.post(f"{base_url}/api/friend-requests/{request_id}/accept").ok
            expect(owner_direct_composer).to_be_visible(timeout=10000)
            expect(page.locator(".direct-composer-status")).to_be_hidden()
            expect(owner_direct_composer).to_have_value("Keep this direct draft")
            page.keyboard.press("Escape")
            page.locator("#conversation-tab-direct").click()
            expect(page.locator(".conversation-item").first).to_contain_text("Live direct edited by Mate")
            expect(page.locator(".conversation-item").first.locator(".unread-pill")).to_have_count(0)
            page.locator("#notification-button").click()
            expect(page.locator("#notification-tabs")).to_contain_text("Messages")
            page.get_by_role("tab", name="Messages", exact=False).click()
            expect(page.get_by_role("tab", name="Messages", exact=False)).to_have_attribute("aria-selected", "true")
            expect(page.get_by_text("You received a new message from Mate.", exact=True)).to_be_visible()
            message_count = page.locator(".notification-item").count()
            page.locator("#notification-select-all").check()
            expect(page.locator("#notification-selection-count")).to_have_text(f"{message_count} selected")
            page.get_by_role("tab", name="Other", exact=False).click()
            expect(page.get_by_role("tab", name="Other", exact=False)).to_have_attribute("aria-selected", "true")
            expect(page.locator("#notification-selection-count")).to_have_text("0 selected")
            expect(page.get_by_role("button", name="Delete selected")).to_be_disabled()
            expect(page.locator(".notification-item")).to_contain_text('Mate requested to join your group "Leaf crew notification wrapping test".')
            link_bounds = page.locator(".notification-link").evaluate("el => {const t=el.parentElement.querySelector('.notification-time').getBoundingClientRect(),l=el.getBoundingClientRect(),c=el.closest('.notification-item').getBoundingClientRect();return {timeBottom:t.bottom,linkTop:l.top,cardLeft:c.left,cardRight:c.right,linkRight:l.right};}")
            assert link_bounds["linkTop"] >= link_bounds["timeBottom"] and link_bounds["linkRight"] <= link_bounds["cardRight"]
            page.get_by_role("tab", name="Messages", exact=False).click()
            expect(page.get_by_role("tab", name="Messages", exact=False)).to_have_attribute("aria-selected", "true")
            expect(page.locator("#notification-select-all")).to_be_checked()
            page.locator("#notification-select-all").uncheck()
            expect(page.locator("#notification-selection-count")).to_have_text("0 selected")
            page.get_by_label("Select notification from Mate").first.check()
            page.get_by_role("button", name="Delete selected").click()
            expect(page.locator("#action-confirm-dialog")).to_be_visible()
            expect(page.locator("#action-confirm-dialog .confirm-message")).to_contain_text("1 selected notification")
            page.locator("#action-confirm-dialog").get_by_role("button", name="Cancel").click()
            expect(page.get_by_text("You received a new message from Mate.", exact=True)).to_be_visible()
            page.get_by_role("button", name="Delete selected").click()
            page.locator("#action-confirm-dialog").get_by_role("button", name="Delete 1").click()
            expect(page.get_by_text("You received a new message from Mate.", exact=True)).to_have_count(0)
            message_count = page.locator(".notification-item").count()
            assert message_count > 0
            page.get_by_role("button", name="Clear all").click()
            expect(page.locator("#action-confirm-dialog .confirm-message")).to_contain_text(f"all {message_count} message notifications")
            page.locator("#action-confirm-dialog").get_by_role("button", name="Cancel").click()
            expect(page.locator(".notification-item")).to_have_count(message_count)
            page.get_by_role("button", name="Clear all").click()
            page.locator("#action-confirm-dialog").get_by_role("button", name=f"Clear {message_count}").click()
            expect(page.locator(".notification-item")).to_have_count(0)
            page.get_by_role("tab", name="Other", exact=False).click()
            if page.locator(".notification-item").count():
                other_count = page.locator(".notification-item").count()
                page.get_by_role("button", name="Clear all").click()
                expect(page.locator("#action-confirm-dialog")).to_be_visible()
                page.locator("#action-confirm-dialog").get_by_role("button", name="Cancel").click()
                expect(page.locator(".notification-item")).to_have_count(other_count)
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
            expect(page.locator("#message-count")).to_have_text("2")
            page.goto(f"{base_url}/#/messages")
            expect(page.locator(".new-messages-divider")).to_be_visible()
            divider = page.locator(".new-messages-divider")
            visible_before = page.locator(".message-row").evaluate_all("(rows, d) => rows.filter(row => row.compareDocumentPosition(d[0]) & Node.DOCUMENT_POSITION_FOLLOWING).filter(row => { const r=row.getBoundingClientRect(),s=document.querySelector('.direct-stream').getBoundingClientRect();return r.top>=s.top&&r.bottom<=s.bottom; }).length", [divider.element_handle()])
            assert visible_before >= 2
            page.locator("#direct-stream").evaluate("el => el.scrollTop=el.scrollHeight")
            expect(page.locator(".new-messages-divider")).to_be_visible()
            for short_text in ("Direct hello", "Unread direct batch two"):
                short_bubble = page.locator("#direct-stream p.message-bubble").filter(has_text=short_text).last
                assert page.evaluate("el => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => { const r=document.createRange();r.selectNodeContents(el);resolve(r.getClientRects().length===1); })))", short_bubble.element_handle())
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
            screenshot_dir=Path(os.getenv("STUDYPILOT_SCREENSHOT_DIR",str(tmp_path / "screenshots")))
            screenshot_dir.mkdir(parents=True,exist_ok=True)
            page.evaluate("document.activeElement.blur(); document.querySelector('#app-message').hidden = true")
            for width, theme in ((1280, "light"), (1280, "dark"), (1600, "light"), (1600, "dark"), (390, "light"), (390, "dark")):
                page.set_viewport_size({"width": width, "height": 900})
                page.evaluate("([theme]) => document.documentElement.dataset.theme = theme", [theme])
                page.screenshot(path=str(screenshot_dir / f"messages-{width}-{theme}.png"), full_page=True)
            assert direct["id"]
    finally:
        server.should_exit = True
        thread.join(timeout=5)


def test_conversation_controls_and_notification_layout_browser(tmp_path, monkeypatch):
    import uvicorn

    monkeypatch.setenv("DB_PATH", str(tmp_path / "controls-browser.db"))
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
            _ok(owner.request.post(f"{base_url}/api/auth/register", data={"email": "owner-controls@example.edu", "username": "ownercontrols", "name": "Owner", "password": "study-together-123"}))
            _ok(mate.request.post(f"{base_url}/api/auth/register", data={"email": "mate-controls@example.edu", "username": "matecontrols", "name": "Mate with a deliberately long display name for wrapping coverage", "password": "study-together-123"}))
            project = owner.request.post(f"{base_url}/api/projects", data={"name": "Leaf crew notification wrapping test", "description": "", "avatar": "mint"}).json()
            code = owner.request.get(f"{base_url}/api/projects/{project['id']}").json()["join_code"]
            _ok(mate.request.post(f"{base_url}/api/projects/join-requests", data={"code": code}))
            pending = owner.request.get(f"{base_url}/api/projects/{project['id']}/join-requests").json()[0]
            _ok(owner.request.post(f"{base_url}/api/projects/{project['id']}/join-requests/{pending['id']}/approve"))
            direct = owner.request.post(f"{base_url}/api/direct/conversations", data={"recipient_id": 2}).json()
            _ok(mate.request.post(f"{base_url}/api/direct/conversations/{direct['id']}/messages", data={"body": "Visible before clear"}))
            for index in range(4):
                _ok(mate.request.post(f"{base_url}/api/direct/conversations/{direct['id']}/messages", data={"body": f"Notification {index}"}))
            owner.request.post(f"{base_url}/api/projects", data={"name": "Quiet study group", "description": "", "avatar": "ocean"})

            page = owner.new_page()
            mate_page = mate.new_page()
            page.goto(f"{base_url}/#/messages")
            page.locator("#conversation-tab-groups").click()
            expect(page.locator(".conversation-row")).to_have_count(2)
            page.locator('summary[aria-label="Conversation actions for Quiet study group"]').click()
            page.locator(".conversation-action-list").get_by_role("button", name="Pin conversation").click()
            expect(page.locator(".conversation-row").first).to_contain_text("Quiet study group")
            page.locator("#conversation-tab-direct").click()
            page.locator('summary[aria-label="Conversation actions for Mate with a deliberately long display name for wrapping coverage"]').click()
            page.locator(".conversation-action-list").get_by_role("button", name="Rename chat").click()
            expect(page.locator("#rename-conversation-dialog")).to_be_visible()
            page.locator("#conversation-nickname").fill("Bro Med")
            page.locator("#rename-conversation-form").get_by_role("button", name="Save nickname").click()
            expect(page.locator(".conversation-item strong")).to_have_text("Bro Med")
            page.locator('summary[aria-label="Conversation actions for Bro Med"]').click()
            page.locator(".conversation-action-list").get_by_role("button", name="Mark as read").click()
            expect(page.locator(".conversation-item .unread-pill")).to_have_count(0)
            page.locator('summary[aria-label="Conversation actions for Bro Med"]').click()
            page.locator(".conversation-action-list").get_by_role("button", name="Mark as unread").click()
            expect(page.locator(".conversation-item .unread-pill")).to_be_visible()
            mate_page.goto(f"{base_url}/#/messages")
            mate_page.locator("#conversation-tab-direct").click()
            expect(mate_page.locator(".conversation-item strong")).to_have_text("Owner")

            visual_dir=Path(os.getenv("STUDYPILOT_SCREENSHOT_DIR",str(tmp_path / "screenshots")))
            visual_dir.mkdir(parents=True,exist_ok=True)
            for theme in ("light", "dark"):
                _ok(owner.request.patch(f"{base_url}/api/profile", data={"name": "Owner", "theme": theme}))
                page.reload()
                for width in (1280, 1600, 390):
                    page.set_viewport_size({"width": width, "height": 900})
                    page.locator("#notification-button").click()
                    dialog = page.locator("#notifications-dialog")
                    expect(dialog).to_be_visible()
                    expect(dialog.get_by_role("heading", name="Notifications")).to_be_visible()
                    for label in ("All", "Messages", "Other"):
                        expect(dialog.get_by_role("tab", name=label, exact=False)).to_be_visible()
                    expect(dialog.locator("#notification-select-all")).to_be_visible()
                    expect(dialog.locator("#notification-delete-selected")).to_be_visible()
                    expect(dialog.locator("#notification-clear-all")).to_be_visible()
                    expect(dialog.locator(".notification-check").first).to_be_visible()
                    bounds = dialog.evaluate("d => {const r=d.getBoundingClientRect(),p=d.querySelector('.notifications-panel').getBoundingClientRect();return {left:r.left,right:r.right,pLeft:p.left,pRight:p.right,viewport:innerWidth};}")
                    assert bounds["left"] >= 0 and bounds["right"] <= bounds["viewport"]
                    assert bounds["pLeft"] >= bounds["left"] and bounds["pRight"] <= bounds["right"]
                    assert abs((bounds["left"] + bounds["right"]) / 2 - width / 2) <= 2
                    page.screenshot(path=str(visual_dir / f"notifications-{width}-{theme}.png"))
                    dialog.get_by_role("button", name="Close").click()

            page.set_viewport_size({"width": 1280, "height": 900})
            page.locator("#conversation-tab-direct").click()
            sidebar_metrics = page.locator("#conversation-list").evaluate("el => ({height:el.clientHeight,scrollHeight:el.scrollHeight,overflow:getComputedStyle(el).overflowY})")
            assert sidebar_metrics["height"] > 0 and sidebar_metrics["scrollHeight"] <= sidebar_metrics["height"] + 1
            assert sidebar_metrics["overflow"] == "auto"
            page.locator("#conversation-list").evaluate("el => { const row=el.querySelector('.conversation-row'); for(let i=0;i<16;i++){const clone=row.cloneNode(true);clone.dataset.layoutProbe=String(i);el.append(clone);} }")
            long_list_metrics = page.locator("#conversation-list").evaluate("el => ({height:el.clientHeight,scrollHeight:el.scrollHeight})")
            assert long_list_metrics["scrollHeight"] > long_list_metrics["height"]
            page.locator("#conversation-list [data-layout-probe]").evaluate_all("rows => rows.forEach(row=>row.remove())")
            for width, theme in ((1280, "light"), (1280, "dark"), (1600, "light"), (1600, "dark"), (390, "light"), (390, "dark")):
                page.set_viewport_size({"width": width, "height": 844 if width == 390 else 900})
                page.evaluate("theme => document.documentElement.dataset.theme = theme", theme)
                fit = page.locator("#conversation-list").evaluate("el => ({height:el.clientHeight,scrollHeight:el.scrollHeight})")
                assert fit["height"] > 0 and fit["scrollHeight"] <= fit["height"] + 1
                page.locator('summary[aria-label="Conversation actions for Bro Med"]').focus()
                page.keyboard.press("Enter")
                expect(page.locator(".conversation-action-list")).to_be_visible()
                expect(page.locator(".conversation-action-list")).to_have_css("position", "fixed")
                bounds = page.locator(".conversation-action-list").evaluate("el => {const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,position:getComputedStyle(el).position};}")
                assert bounds["position"] == "fixed" and bounds["left"] >= 0 and bounds["right"] <= width
                page.keyboard.press("Escape")
                expect(page.locator(".conversation-actions-menu[open]")).to_have_count(0)
            page.set_viewport_size({"width": 390, "height": 844})
            mobile_menu=page.locator('summary[aria-label="Conversation actions for Bro Med"]')
            mobile_menu.focus()
            page.keyboard.press("Enter")
            expect(page.locator(".conversation-action-list")).to_be_visible()
            menu_metrics=page.locator(".conversation-action-list").evaluate("el => {const r=el.getBoundingClientRect();return {position:getComputedStyle(el).position,left:r.left,right:r.right,top:r.top,bottom:r.bottom};}")
            assert menu_metrics["position"] == "fixed" and menu_metrics["left"] >= 0 and menu_metrics["right"] <= 390
            expect(page.locator(".conversation-action-list .menu-danger")).to_have_css("color", "rgb(255, 133, 142)")
            page.evaluate("document.documentElement.dataset.theme = 'light'")
            expect(page.locator(".conversation-action-list .menu-danger")).to_have_css("color", "rgb(196, 62, 76)")
            page.evaluate("document.documentElement.dataset.theme = 'dark'")
            page.keyboard.press("Escape")
            expect(page.locator(".conversation-actions-menu[open]")).to_have_count(0)
            page.set_viewport_size({"width": 1280, "height": 900})
            page.locator(".conversation-item").click()
            expect(page.locator(".thread-header .thread-profile-trigger")).to_have_text("Bro Med")
            page.locator('summary[aria-label="Conversation actions for Bro Med"]').click()
            page.locator(".conversation-action-list").get_by_role("button", name="Clear chat for me").click()
            page.locator("#action-confirm-dialog").get_by_role("button", name="Clear chat").click()
            expect(page.get_by_text("Visible before clear", exact=True)).to_have_count(0)
            mate_page.locator(".conversation-item").click()
            expect(mate_page.get_by_text("Visible before clear", exact=True)).to_be_visible()
            composer = mate_page.get_by_role("textbox", name="Private message")
            composer.fill("New after clear")
            mate_page.get_by_role("button", name="Send").click()
            page.locator(".conversation-item").click()
            expect(page.locator("#direct-stream .message-bubble").filter(has_text="New after clear")).to_be_visible(timeout=9000)
            page.locator('summary[aria-label="Conversation actions for Bro Med"]').click()
            page.locator(".conversation-action-list").get_by_role("button", name="Archive conversation").click()
            page.locator("#archived-conversations-toggle").click()
            expect(page.locator(".conversation-item strong")).to_have_text("Bro Med")
            archived_metrics = page.locator("#conversation-list").evaluate("el => ({height:el.clientHeight,scrollHeight:el.scrollHeight})")
            assert archived_metrics["height"] > 0 and archived_metrics["scrollHeight"] <= archived_metrics["height"] + 1
            page.locator('summary[aria-label="Conversation actions for Bro Med"]').click()
            page.locator(".conversation-action-list").get_by_role("button", name="Unarchive conversation").click()
            page.locator("#archived-conversations-toggle").click()
            expect(page.locator(".conversation-item strong")).to_have_text("Bro Med")
    finally:
        server.should_exit = True
        thread.join(timeout=5)
