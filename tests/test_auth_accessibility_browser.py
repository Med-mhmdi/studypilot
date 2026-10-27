import socket
import threading
import time
from pathlib import Path

import pytest

pytest.importorskip("playwright.sync_api")
from playwright.sync_api import expect, sync_playwright

from app.main import app


def _free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def test_auth_accessibility_validation_autocomplete_and_mobile(tmp_path, monkeypatch):
    import uvicorn

    monkeypatch.setenv("DB_PATH", str(tmp_path / "auth-browser.db"))
    monkeypatch.setenv("SESSION_SECRET", "auth-browser-test-key")
    monkeypatch.setenv("COOKIE_SECURE", "false")
    port = _free_port()
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
            launch = {}
            chrome = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")
            if chrome.exists():
                launch["executable_path"] = str(chrome)
            browser = automation.chromium.launch(**launch)
            api = automation.request.new_context()
            seed = api.post(f"{base}/api/auth/register", data={"email":"existing@example.edu","username":"existing","name":"Existing Student","password":"study-together-123"})
            assert seed.status == 201
            context = browser.new_context(viewport={"width":390,"height":844}, is_mobile=True, has_touch=True)
            context.set_default_timeout(5000)
            page = context.new_page()
            page.goto(base)

            email = page.locator("#auth-form [name=email]")
            password = page.locator("#auth-form [name=password]")
            expect(page.locator("#auth-screen")).to_be_visible()
            assert email.get_attribute("autocomplete") == "username"
            assert password.get_attribute("autocomplete") == "current-password"
            toggle = page.locator("#auth-form .password-toggle")
            expect(toggle).to_have_attribute("aria-label", "Show password")
            expect(password).to_have_attribute("type", "password")
            email.fill("not-an-email")
            page.locator("#auth-submit").click()
            expect(page.locator("#auth-email-error")).to_contain_text("valid email address")
            assert page.locator("#auth-email-error").is_visible()
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")

            email.fill("existing@example.edu")
            password.fill("wrong-password")
            page.route("**/api/auth/login", lambda route: route.abort())
            page.locator("#auth-submit").click()
            expect(page.locator("#auth-error")).to_have_text("Unable to reach StudyPilot. Check your connection and try again.")
            page.unroute("**/api/auth/login")
            page.route("**/api/auth/login", lambda route: route.fulfill(status=503, content_type="application/json", body='{"detail":"internal database error"}'))
            page.locator("#auth-submit").click()
            expect(page.locator("#auth-error")).to_have_text("StudyPilot is having trouble right now. Try again shortly.")
            page.unroute("**/api/auth/login")
            page.locator("#auth-submit").click()
            expect(page.locator("#auth-error")).to_have_text("Incorrect email or password.")
            page.locator("#auth-switch").click()
            expect(page.locator("#auth-error")).to_be_empty()
            assert email.get_attribute("autocomplete") == "email"
            assert password.get_attribute("autocomplete") == "new-password"
            toggle.click()
            expect(password).to_have_attribute("type", "text")
            expect(toggle).to_have_attribute("aria-pressed", "true")
            expect(toggle).to_have_attribute("aria-label", "Hide password")
            assert toggle.evaluate("el=>document.activeElement===el")
            expect(password).to_have_value("wrong-password")
            toggle.click()
            expect(password).to_have_attribute("type", "password")
            expect(toggle).to_have_attribute("aria-pressed", "false")
            expect(password).to_have_value("wrong-password")

            email.fill("existing@example.edu")
            page.locator("#name-field input").fill("Duplicate Student")
            page.locator("#username-field input").fill("duplicate")
            password.fill("study-together-123")
            page.locator("#auth-submit").click()
            expect(page.locator("#auth-error")).to_have_text("An account with this email already exists.")
            email.fill("mobile@example.edu")
            page.locator("#name-field input").fill("Mobile Student")
            page.locator("#username-field input").fill("mobile")
            page.locator("#auth-submit").click()
            expect(page.locator("#app-screen")).to_be_visible()
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")

            page.set_viewport_size({"width":1280,"height":900})
            page.wait_for_timeout(100)
            page.locator("#account-button").click()
            expect(page.locator("#account-menu")).to_be_visible()
            page.locator("#settings-open").click()
            current = page.locator("#settings-form [name=current_password]")
            new = page.locator("#settings-form [name=new_password]")
            assert current.get_attribute("autocomplete") == "current-password"
            assert new.get_attribute("autocomplete") == "new-password"
            current.fill("current-secret")
            current_toggle = current.locator("xpath=following-sibling::button")
            current_toggle.click()
            expect(current).to_have_attribute("type", "text")
            expect(current).to_have_value("current-secret")
            current_toggle.click()
            expect(current).to_have_attribute("type", "password")
            page.locator('#settings-dialog button[data-close="settings-dialog"]').last.click()

            page.locator("#account-button").click()
            page.locator("#profile-open").click()
            page.locator("#delete-account-open").click()
            deletion = page.locator("#delete-account-form [name=current_password]")
            assert deletion.get_attribute("autocomplete") == "current-password"
            deletion.fill("delete-secret")
            deletion_toggle = deletion.locator("xpath=following-sibling::button")
            deletion_toggle.click()
            expect(deletion).to_have_attribute("type", "text")
            expect(deletion).to_have_value("delete-secret")
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
            page.locator('#delete-account-dialog button[data-close="delete-account-dialog"]').first.click()
            expired = page.evaluate("fetch('/api/auth/logout',{method:'POST'}).then(()=>api('/api/tasks').catch(error=>error.message))")
            assert expired == "Your session expired. Please sign in again."
            expect(page.locator("#auth-screen")).to_be_visible()
            expect(page.locator("#auth-error")).to_have_text("Your session expired. Please sign in again.")
            api.dispose()
    finally:
        server.should_exit = True
        thread.join(timeout=5)
