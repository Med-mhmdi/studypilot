import io
import os
import re
import socket
import threading
import time
from pathlib import Path

from PIL import Image
import pytest

pytest.importorskip("playwright.sync_api")
from playwright.sync_api import expect, sync_playwright

from app.main import app


def _free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _image_bytes(size=(720, 480)):
    image = Image.new("RGB", size)
    pixels = image.load()
    for x in range(image.width):
        for y in range(image.height):
            pixels[x, y] = (220, 60, 80) if x < image.width // 2 else (40, 105, 210)
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def test_join_request_ui_search_profile_photo_and_classmates(tmp_path, monkeypatch):
    import uvicorn

    monkeypatch.setenv("DB_PATH", str(tmp_path / "people-browser.db"))
    monkeypatch.setenv("SESSION_SECRET", "people-browser-session-key")
    monkeypatch.setenv("COOKIE_SECURE", "false")
    port = _free_port()
    base = f"http://127.0.0.1:{port}"
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    browser = None
    try:
        deadline = time.time() + 10
        import urllib.request
        while time.time() < deadline and not server.started:
            time.sleep(.05)
        assert server.started
        with urllib.request.urlopen(f"{base}/health", timeout=3) as response:
            assert response.status == 200

        screenshot_dir=Path(os.getenv("STUDYPILOT_SCREENSHOT_DIR",str(tmp_path / "screenshots")))
        screenshot_dir.mkdir(parents=True,exist_ok=True)
        with sync_playwright() as automation:
            launch_options = {}
            chrome = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")
            if chrome.exists():
                launch_options["executable_path"] = str(chrome)
            browser = automation.chromium.launch(**launch_options)
            owner = browser.new_context(viewport={"width":1280,"height":900})
            admin = browser.new_context(viewport={"width":1280,"height":900})
            student = browser.new_context(viewport={"width":1280,"height":900})
            stranger = browser.new_context(viewport={"width":1280,"height":900})
            for context in (owner, admin, student, stranger):
                context.set_default_timeout(5000)
            for context, email, username, name in (
                (owner,"owner@example.edu","owner","Owner"),
                (admin,"admin@example.edu","admin","Admin"),
                (student,"student@example.edu","student","Student"),
                (stranger,"stranger@example.edu","stranger","Stranger"),
            ):
                response=context.request.post(f"{base}/api/auth/register",data={"email":email,"username":username,"name":name,"password":"study-together-123"})
                assert response.ok,response.text()
            owner_api,admin_api,student_api,stranger_api=(c.request for c in (owner,admin,student,stranger))
            chem=owner_api.post(f"{base}/api/projects",data={"name":"Chemistry Circle","avatar":"mint"}).json()
            physics=owner_api.post(f"{base}/api/projects",data={"name":"Physics Circle","avatar":"ocean"}).json()
            _ok=admin_api.post(f"{base}/api/projects/join-requests",data={"code":chem["join_code"]})
            admin_req=owner_api.get(f"{base}/api/projects/{chem['id']}/join-requests").json()[0]
            assert owner_api.post(f"{base}/api/projects/{chem['id']}/join-requests/{admin_req['id']}/approve").ok
            assert owner_api.patch(f"{base}/api/projects/{chem['id']}/members/2",data={"role":"admin"}).ok
            profile_photo=Image.new("RGB",(80,80),"#6657d9");photo_buffer=io.BytesIO();profile_photo.save(photo_buffer,format="PNG")
            assert student_api.patch(f"{base}/api/profile",data={"name":"Student","bio":"Group study fan"}).ok
            assert owner_api.post(f"{base}/api/friend-requests",data={"username":"student"}).ok
            friend_id=student_api.get(f"{base}/api/friend-requests").json()[0]["id"]
            assert student_api.post(f"{base}/api/friend-requests/{friend_id}/accept").ok
            assert student_api.post(f"{base}/api/profile/photo",multipart={"photo":{"name":"face.png","mimeType":"image/png","buffer":photo_buffer.getvalue()}}).ok

            # Student request submission, withdrawal, and persistent status history.
            student_page=student.new_page()
            student_page.goto(f"{base}/#/groups")
            student_page.locator("#join-group-open").click()
            student_page.locator("#join-form input[name=code]").fill(chem["join_code"])
            student_page.locator("#join-form").get_by_role("button",name="Request to join").click()
            expect(student_page.locator("#join-dialog")).not_to_be_visible()
            student_page.locator("#my-join-requests-open").click()
            expect(student_page.locator("#my-join-requests .join-request-status")).to_have_text("Pending")
            student_page.locator("#my-join-requests").get_by_role("button",name="Withdraw").click()
            confirm=student_page.locator("#action-confirm-dialog")
            expect(confirm).to_be_visible()
            confirm.get_by_role("button",name="Withdraw").click()
            expect(student_page.locator("#my-join-requests .join-request-status")).to_have_text("Cancelled")
            student_page.locator("#my-join-requests-dialog").get_by_role("button",name="Done").click()

            # The admin can review their own group's incoming queue and approve.
            student_page.locator("#join-group-open").click()
            student_page.locator("#join-form input[name=code]").fill(chem["join_code"])
            student_page.locator("#join-form").get_by_role("button",name="Request to join").click()
            admin_page=admin.new_page()
            admin_page.goto(f"{base}/#/groups")
            screenshot_dir.mkdir(parents=True,exist_ok=True)
            expect(admin_page.locator(".project-card").first).to_be_visible()
            expect(admin_page.locator("dialog[open]")).to_have_count(0)
            expect(admin_page.locator("#profile-photo-viewer")).not_to_be_visible()
            for width in (1280,1600,390):
                admin_page.set_viewport_size({"width":width,"height":844 if width==390 else 900})
                for theme in ("light","dark"):
                    admin_page.evaluate("theme => document.documentElement.dataset.theme=theme",theme)
                    admin_page.screenshot(path=str(screenshot_dir/f"groups-listing-{width}-{theme}.png"),full_page=False)
            admin_page.set_viewport_size({"width":1280,"height":900})
            admin_page.evaluate("document.documentElement.dataset.theme='light'")
            admin_page.locator(".project-card").filter(has_text="Chemistry Circle").click()
            expect(admin_page.locator(".group-requests-button")).to_be_visible()
            expect(admin_page.locator("#group-join-requests")).to_have_count(1)
            action_row=admin_page.locator(".group-hero-actions")
            action_buttons=action_row.locator(":scope > :is(button,a)")
            assert action_buttons.count()>=3
            y_centers=action_row.evaluate("el=>[...el.querySelectorAll(':scope > button, :scope > a, :scope > details > summary')].map(button=>{const r=button.getBoundingClientRect();return r.top+r.height/2})")
            assert max(y_centers)-min(y_centers)<=2
            for width,theme in ((1280,"light"),(1280,"dark"),(1600,"light"),(1600,"dark"),(390,"light"),(390,"dark")):
                admin_page.set_viewport_size({"width":width,"height":844 if width==390 else 900})
                admin_page.evaluate("theme => document.documentElement.dataset.theme=theme",theme)
                bounds=action_row.evaluate("el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,scroll:el.scrollWidth,client:el.clientWidth}}")
                assert bounds["left"]>=0 and bounds["right"]<=width and bounds["scroll"]<=bounds["client"]+1
                admin_page.screenshot(path=str(screenshot_dir/f"group-workspace-{width}-{theme}.png"),full_page=False)
            admin_page.set_viewport_size({"width":1280,"height":900})
            admin_page.goto(f"{base}/#/groups")
            expect(admin_page.locator(".project-request-badge")).to_contain_text("1 join request")
            admin_page.locator(".project-request-badge").click()
            expect(admin_page.locator("#join-requests-dialog")).to_be_visible()
            expect(admin_page.locator("#group-join-requests .join-request-card")).to_contain_text("Student")
            admin_page.locator("#group-join-requests").get_by_role("button",name="Accept").click()
            expect(admin_page.locator("#group-join-requests")).to_contain_text("No pending requests")
            student_page.locator("#my-join-requests-open").click()
            expect(student_page.locator("#my-join-requests .join-request-status").filter(has_text="Accepted")).to_be_visible()
            expect(student_page.locator("#my-join-requests .person-copy strong").filter(has_text="Chemistry Circle").first).to_be_visible()
            student_page.locator("#my-join-requests-dialog").get_by_role("button",name="Done").click()

            # Owner rejection is visible in the student's own request history.
            student_page.locator("#join-group-open").click()
            student_page.locator("#join-form input[name=code]").fill(physics["join_code"])
            student_page.locator("#join-form").get_by_role("button",name="Request to join").click()
            owner_page=owner.new_page()
            owner_page.goto(f"{base}/#/groups")
            owner_page.locator(".project-request-badge").first.click()
            expect(owner_page.locator("#join-requests-dialog")).to_be_visible()
            owner_page.locator("#group-join-requests").get_by_role("button",name="Decline").click()
            student_page.locator("#my-join-requests-open").click()
            expect(student_page.locator("#my-join-requests .join-request-status").filter(has_text="Rejected")).to_be_visible()
            assert any(group["id"] == chem["id"] for group in student_api.get(f"{base}/api/projects").json())

            # Profile modal is read-only, safe, and usable from classmate cards.
            student_page.locator("#my-join-requests-dialog").get_by_role("button",name="Done").click()
            student_page.goto(f"{base}/#/people")
            student_page.locator("#people-tabs").get_by_role("button",name="Friends").click()
            friend_card=student_page.locator("#people-panel-list .person-card").filter(has_text="Owner")
            friend_card.locator(".profile-name-trigger").click()
            profile=student_page.locator("#classmate-profile-dialog")
            expect(profile).to_be_visible()
            expect(profile).to_contain_text("@owner")
            expect(profile).not_to_contain_text("@example.edu")
            profile.locator(".classmate-profile-bio").get_by_text("No bio added yet.").is_visible()
            expect(profile.locator(".classmate-profile-menu")).to_have_count(0)
            expect(profile.get_by_role("button",name="Block Owner")).to_be_visible()
            profile.locator(".classmate-profile-avatar").click()
            expect(student_page.locator("#profile-photo-viewer")).to_be_visible()
            student_page.locator(".profile-photo-close").click()
            profile.get_by_role("button",name="Close").click()

            # Search results are explicit, temporary, and the empty state is neutral.
            search=student_page.locator("#friend-search-form input[name=username]")
            search.fill("owner")
            expect(student_page.locator("#people-results")).to_be_empty()
            student_page.locator("#friend-search-form").get_by_role("button",name="Search").click()
            expect(student_page.locator("#people-results .person-card")).to_have_count(1)
            search.fill("stranger")
            student_page.locator("#friend-search-form").get_by_role("button",name="Search").click()
            stranger_card=student_page.locator("#people-results .person-card").filter(has_text="Stranger")
            expect(stranger_card).to_be_visible()
            stranger_card.locator(".profile-name-trigger").click()
            public_profile=student_page.locator("#classmate-profile-dialog")
            expect(public_profile).to_be_visible()
            expect(public_profile).to_contain_text("@stranger")
            expect(public_profile).not_to_contain_text("@example.edu")
            expect(public_profile).to_contain_text("Add this classmate to message")
            public_profile.get_by_role("button",name="Close").click()
            search.fill("stranger")
            student_page.locator("#friend-search-form").get_by_role("button",name="Search").click()
            stranger_card=student_page.locator("#people-results .person-card").filter(has_text="Stranger")
            stranger_card.get_by_role("button",name="Add classmate").click()
            expect(search).to_have_value("")
            expect(student_page.locator("#people-results")).to_be_empty()
            expect(student_page.locator("#friend-search-note")).to_have_text("Request sent to @stranger.")
            search.fill("stranger")
            student_page.locator("#friend-search-form").get_by_role("button",name="Search").click()
            cancel_request=student_page.locator("#people-results .person-card").get_by_role("button",name="Cancel request")
            expect(cancel_request).to_be_visible()
            assert cancel_request.evaluate("el=>getComputedStyle(el).color") in ("rgb(162, 63, 75)","rgb(180, 66, 77)")
            student_page.set_viewport_size({"width":390,"height":844})
            assert cancel_request.evaluate("el=>{const r=el.getBoundingClientRect();return r.width===42&&r.height===42&&el.getAttribute('aria-label')==='Cancel request'&&!!el.querySelector('svg')}")
            cancel_request.click()
            expect(student_page.locator("#people-tabs .people-tab").filter(has_text="Outgoing").locator("strong")).to_have_text("0")
            student_page.set_viewport_size({"width":1280,"height":900})
            search.fill("unknown-person")
            expect(student_page.locator("#people-results")).to_be_empty()
            student_page.locator("#friend-search-form").get_by_role("button",name="Search").click()
            expect(student_page.locator(".people-search-empty strong")).to_have_text("No classmate found")
            expect(student_page.locator(".people-search-empty")).not_to_have_css("color","rgb(196, 62, 76)")
            student_page.locator("#people-tabs").get_by_role("button",name="Incoming").click()
            expect(student_page.locator(".people-search-empty")).to_have_count(0)

            # Light/dark selected tabs and block/unblock list actions.
            friends_tab=student_page.locator("#people-tabs").get_by_role("button",name="Friends 1")
            if friends_tab.get_attribute("aria-expanded") != "true":
                friends_tab.click()
            friend_actions=student_page.locator("#people-panel-list .person-card .classmate-action-button")
            friend_action_metrics=friend_actions.evaluate_all("els=>els.map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {width:r.width,height:r.height,font:s.fontSize,weight:s.fontWeight,radius:s.borderRadius}})")
            assert len(friend_action_metrics)==2 and all(abs(metrics["height"]-38)<0.1 for metrics in friend_action_metrics)
            assert friend_action_metrics[0]["font"]==friend_action_metrics[1]["font"] and friend_action_metrics[0]["weight"]==friend_action_metrics[1]["weight"]
            search_metrics=student_page.locator("#friend-search-form button").evaluate("el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {width:r.width,height:r.height,cssHeight:s.height,svg:!!el.querySelector('svg'),label:el.getAttribute('aria-label')}}")
            assert abs(search_metrics["height"]-38)<0.1 and search_metrics["svg"] and search_metrics["label"]=="Search", search_metrics
            student_page.set_viewport_size({"width":390,"height":844})
            mobile_action_metrics=[action.evaluate("el=>{const r=el.getBoundingClientRect();return {width:r.width,height:r.height,svg:!!el.querySelector('svg'),label:el.getAttribute('aria-label'),spans:[...el.children].filter(child=>child.tagName==='SPAN').length}}") for action in [friend_actions.nth(0),friend_actions.nth(1),student_page.locator("#friend-search-form button")]]
            assert all(abs(item["width"]-42)<0.1 and abs(item["height"]-42)<0.1 and item["svg"] and item["spans"] for item in mobile_action_metrics), mobile_action_metrics
            student_page.set_viewport_size({"width":1280,"height":900})
            for theme in ("light","dark"):
                student_page.evaluate("theme => document.documentElement.dataset.theme=theme",theme)
                active=student_page.locator('#people-tabs .people-tab[aria-expanded="true"]')
                assert active.evaluate("el => getComputedStyle(el).backgroundColor") != "rgba(0, 0, 0, 0)"
                expect(active.locator("strong")).to_have_css("color", "rgb(73, 57, 174)" if theme=="light" else "rgb(232, 226, 255)")
            student_page.locator("#people-panel-list").get_by_role("button",name="Block").click()
            confirm=student_page.locator("#action-confirm-dialog")
            expect(confirm).to_be_visible()
            confirm.get_by_role("button",name="Block").click()
            student_page.locator("#people-tabs").get_by_role("button",name="Blocked").click()
            expect(student_page.locator("#people-panel-list").get_by_role("button",name="Unblock")).to_be_visible()
            student_page.locator("#people-panel-list").get_by_role("button",name="Unblock").click()
            expect(student_page.locator("#people-panel-list").get_by_role("button",name="Unblock")).to_have_count(0)
            assert student_api.get(f"{base}/api/friend-requests").json() == []

            # Real image crop: cancel keeps the saved photo unchanged; apply stores a square crop.
            student_page.locator("#account-button").click()
            student_page.locator("#profile-open").click()
            student_page.locator("#profile-avatar-preview").click()
            expect(student_page.locator("#profile-photo-viewer")).to_be_visible()
            expect(student_page.locator("#profile-photo-editor")).not_to_be_visible()
            student_page.locator(".profile-photo-close").click()
            buffer=_image_bytes()
            student_page.locator("#profile-photo-upload").click()
            tall_buffer=_image_bytes((420,900))
            student_page.locator("#profile-photo").set_input_files({"name":"portrait.png","mimeType":"image/png","buffer":tall_buffer})
            expect(student_page.locator("#profile-photo-editor")).to_be_visible()
            assert student_page.locator("#photo-crop-canvas").evaluate("el => {const d=el.getContext('2d').getImageData(0,0,el.width,el.height).data;for(let i=3;i<d.length;i+=4)if(d[i]!==255)return false;return true}")
            student_page.locator("#profile-photo-editor").get_by_role("button",name="Cancel",exact=True).click()
            buffer=_image_bytes((1200,500))
            student_page.locator("#profile-photo-upload").click()
            student_page.locator("#profile-photo").set_input_files({"name":"wide.png","mimeType":"image/png","buffer":buffer})
            expect(student_page.locator("#photo-crop-canvas")).to_be_visible()
            assert student_page.locator("#photo-crop-canvas").evaluate("el => {const d=el.getContext('2d').getImageData(0,0,el.width,el.height).data;for(let i=3;i<d.length;i+=4)if(d[i]!==255)return false;return true}")
            student_page.locator("#photo-zoom").fill("1.8")
            crop=student_page.locator("#photo-crop-canvas").bounding_box()
            student_page.mouse.move(crop["x"]+crop["width"]*.6,crop["y"]+crop["height"]*.5)
            student_page.mouse.down();student_page.mouse.move(crop["x"]+crop["width"]*.35,crop["y"]+crop["height"]*.5);student_page.mouse.up()
            student_page.locator("#profile-photo-editor").get_by_role("button",name="Cancel",exact=True).click()
            expect(student_page.locator("#profile-photo-editor")).not_to_be_visible()
            assert student_api.get(f"{base}/api/profile/photo").status == 200
            student_page.locator("#profile-photo-upload").click()
            student_page.locator("#profile-photo").set_input_files({"name":"split.png","mimeType":"image/png","buffer":buffer})
            expect(student_page.locator("#profile-photo-editor")).to_be_visible()
            student_page.locator("#photo-zoom").fill("1.5")
            student_page.locator("#photo-crop-confirm").click()
            expect(student_page.locator("#profile-avatar-preview")).to_have_attribute("style", re.compile("blob:"))
            photo_version_before=student_api.get(f"{base}/api/auth/me").json()["profile_photo_version"]
            student_page.locator("#profile-form").get_by_role("button",name="Save profile").click()
            expect(student_page.locator("#avatar")).not_to_have_attribute("data-avatar-version",photo_version_before,timeout=15000)
            saved=student_api.get(f"{base}/api/profile/photo")
            assert saved.status==200 and Image.open(io.BytesIO(saved.body())).size==(512,512)
            original=student_api.get(f"{base}/api/profile/photo/original")
            assert original.status==200 and Image.open(io.BytesIO(original.body())).size==(1200,500)
            profile_state=student_api.get(f"{base}/api/auth/me").json()
            assert profile_state["profile_photo_version"] and profile_state["profile_photo_crop"]
            assert profile_state["active_avatar_source"]=="photo"
            student_page.locator("#profile-dialog button[data-close='profile-dialog']").last.click()
            student_page.locator("#account-button").click()
            student_page.locator("#settings-open").click()
            student_page.locator('.avatar-picker[data-picker="person"] .avatar-choice[aria-label="Jordan"]').click()
            expect(student_page.locator("#avatar")).to_have_attribute("data-avatar-source","avatar")
            assert student_api.get(f"{base}/api/profile/photo").status==200
            student_page.locator("#settings-dialog button[data-close='settings-dialog']").last.click()
            student_page.locator("#account-button").click()
            student_page.locator("#profile-open").click()
            student_page.locator("#profile-photo-view").click()
            expect(student_page.locator("#profile-photo-large")).to_be_hidden()
            expect(student_page.locator("#profile-avatar-large")).to_be_visible()
            student_page.locator(".profile-photo-close").click()
            student_page.locator("#profile-dialog button[data-close='profile-dialog']").last.click()
            student_page.locator("#account-button").click()
            student_page.locator("#settings-open").click()
            photo_state=student_api.get(f"{base}/api/auth/me").json()
            assert photo_state["profile_photo"]
            expect(student_page.locator("#use-saved-profile-photo")).to_be_visible()
            student_page.locator("#use-saved-profile-photo").click()
            expect(student_page.locator("#avatar")).to_have_attribute("data-avatar-source","photo")
            student_page.locator("#settings-dialog button[data-close='settings-dialog']").last.click()
            student_page.locator("#account-button").click()
            student_page.locator("#profile-open").click()
            student_page.locator("#profile-avatar-preview").dblclick()
            expect(student_page.locator("#profile-photo-editor")).to_be_visible()
            student_page.locator("#profile-photo-editor").get_by_role("button",name="Cancel",exact=True).click()
            student_page.locator("#profile-photo-remove").click()
            confirm=student_page.locator("#action-confirm-dialog")
            expect(confirm).to_be_visible()
            expect(confirm).to_contain_text("permanently remove your uploaded photo")
            confirm.get_by_role("button",name="Cancel").click()
            assert student_api.get(f"{base}/api/profile/photo").status==200
            student_page.locator("#profile-photo-remove").click()
            confirm.get_by_role("button",name="Remove photo").click()
            expect(student_page.locator("#profile-saved")).to_contain_text("Your illustrated avatar is active.")
            assert student_api.get(f"{base}/api/profile/photo").status==404
            assert student_api.get(f"{base}/api/auth/me").json()["active_avatar_source"]=="avatar"

            # Verify tab and photo panel fit at all approved viewport sizes and themes.
            for width,theme in ((1280,"light"),(1280,"dark"),(1600,"light"),(1600,"dark"),(390,"light"),(390,"dark")):
                student_page.set_viewport_size({"width":width,"height":844 if width==390 else 900})
                student_page.evaluate("theme => document.documentElement.dataset.theme=theme",theme)
                if not student_page.locator("#profile-dialog").evaluate("el => el.open"):
                    student_page.locator("#account-button").click()
                    student_page.locator("#profile-open").click()
                box=student_page.locator("#profile-dialog").evaluate("el => {const r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,scroll:el.scrollWidth,client:el.clientWidth};}")
                assert box["left"]>=0 and box["right"]<=width and box["scroll"]<=box["client"]+1
                action_metrics=student_page.locator(".profile-photo-actions button").evaluate_all("els=>els.map(el=>{const r=el.getBoundingClientRect();return {width:r.width,height:r.height,label:el.getAttribute('aria-label')}})")
                assert len(action_metrics)==4 and len({(item["width"],item["height"]) for item in action_metrics})==1
                assert [item["label"] for item in action_metrics]==["View","Edit","Upload Photo","Remove Photo"]
                assert all(abs(item["height"]-(44 if width==390 else 36))<=1 for item in action_metrics)
                student_page.screenshot(path=str(screenshot_dir/f"profile-{width}-{theme}.png"))
                student_page.locator('#profile-dialog button[data-close="profile-dialog"]').last.click()
    finally:
        server.should_exit=True
        thread.join(timeout=5)
