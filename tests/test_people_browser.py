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
                centers=action_row.evaluate("el=>[...el.querySelectorAll(':scope > button, :scope > a, :scope > details > summary')].filter(x=>getComputedStyle(x).display!=='none').map(x=>{const r=x.getBoundingClientRect();return r.top+r.height/2})")
                assert max(centers)-min(centers)<=2
                admin_page.screenshot(path=str(screenshot_dir/f"group-workspace-{width}-{theme}.png"),full_page=False)
            admin_page.set_viewport_size({"width":1280,"height":900})
            admin_page.goto(f"{base}/#/groups")
            expect(admin_page.locator(".project-request-badge")).to_contain_text("1 join request")
            admin_page.locator(".project-request-badge").click()
            expect(admin_page.locator("#join-requests-dialog")).to_be_visible()
            expect(admin_page.locator("#group-join-requests .join-request-card")).to_contain_text("Student")
            admin_page.locator("#group-join-requests").get_by_role("button",name="Accept").click()
            expect(admin_page.locator("#group-join-requests")).to_contain_text("No pending requests")
            owner_page=owner.new_page()
            owner_page.goto(f"{base}/#/groups")
            assert owner_api.post(f"{base}/api/friend-requests",data={"username":"stranger"}).ok
            stranger_page=stranger.new_page()
            stranger_page.goto(f"{base}/#/people")
            expect(stranger_page.locator("#classmate-request-count")).to_have_text("1")
            expect(owner_page.locator("#classmate-request-count")).to_be_hidden()
            stranger_page.locator("#people-tabs").get_by_role("button",name="Incoming 1").click()
            accept_button=stranger_page.locator("#people-panel-list").get_by_role("button",name="Accept")
            decline_button=stranger_page.locator("#people-panel-list").get_by_role("button",name="Decline")
            expect(accept_button).to_be_visible()
            assert accept_button.evaluate("el=>getComputedStyle(el).backgroundColor")=="rgb(234, 247, 239)"
            assert decline_button.evaluate("el=>getComputedStyle(el).backgroundColor")=="rgb(102, 87, 217)"
            accept_button.click()
            expect(stranger_page.locator("#classmate-request-count")).to_be_hidden(timeout=10000)
            expect(owner_page.locator("#classmate-request-count")).to_be_hidden()
            student_page.locator("#my-join-requests-open").click()
            expect(student_page.locator("#my-join-requests .join-request-status").filter(has_text="Accepted")).to_be_visible()
            expect(student_page.locator("#my-join-requests .person-copy strong").filter(has_text="Chemistry Circle").first).to_be_visible()
            student_page.locator("#my-join-requests-dialog").get_by_role("button",name="Done").click()
            student_page.goto(f"{base}/#/groups/{chem['id']}")
            expect(student_page.locator(".group-requests-button")).to_have_count(0)
            student_actions=student_page.locator(".group-hero-actions")
            expect(student_actions.get_by_role("button",name="Assignment")).to_be_visible()
            expect(student_actions.get_by_role("link",name="Chat")).to_be_visible()
            for width in (390,1280,1600):
                student_page.set_viewport_size({"width":width,"height":844 if width==390 else 900})
                bounds=student_actions.evaluate("el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,scroll:el.scrollWidth,client:el.clientWidth}}")
                centers=student_actions.evaluate("el=>[...el.querySelectorAll(':scope > button, :scope > a, :scope > details > summary')].map(x=>{const r=x.getBoundingClientRect();return r.top+r.height/2})")
                assert bounds["left"]>=0 and bounds["right"]<=width and bounds["scroll"]<=bounds["client"]+1
                assert max(centers)-min(centers)<=2
            student_page.set_viewport_size({"width":1280,"height":900})
            student_page.locator(".group-actions-menu summary").click()
            expect(student_page.locator(".group-menu-items").get_by_role("button",name="Invite members")).to_be_visible()
            expect(student_page.locator(".group-menu-items button").filter(has_text="Leave group").locator(".menu-icon svg")).to_have_count(1)
            student_page.locator(".group-menu-items").get_by_role("button",name="Invite members").click()
            expect(student_page.locator("#invite-dialog")).to_be_visible()
            expect(student_page.locator("#group-join-code")).to_have_text(chem["join_code"])
            expect(student_page.locator("#rotate-join-code")).to_be_hidden()
            copy_icon=student_page.locator("#copy-join-code svg")
            expect(copy_icon).to_be_visible()
            assert copy_icon.evaluate("el=>{const r=el.getBoundingClientRect();return r.width===19&&r.height===19&&el.getAttribute('stroke-width')==='1.8'}")
            assert student_api.get(f"{base}/api/projects/{chem['id']}/join-requests").status==403
            assert student_api.post(f"{base}/api/projects/{chem['id']}/join-code/rotate").status==403
            student_page.locator("#invite-dialog").get_by_role("button",name="Done").click()
            student_page.goto(f"{base}/#/groups")

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
            search_metrics=student_page.locator("#friend-search-form button").evaluate("el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {width:r.width,height:r.height,cssHeight:s.height,font:s.fontSize,weight:s.fontWeight,radius:s.borderRadius,svg:!!el.querySelector('svg'),label:el.getAttribute('aria-label')}}")
            assert abs(search_metrics["height"]-38)<0.1 and search_metrics["svg"] and search_metrics["label"]=="Search classmates", search_metrics
            assert search_metrics["font"]==friend_action_metrics[0]["font"] and search_metrics["weight"]==friend_action_metrics[0]["weight"] and search_metrics["radius"]==friend_action_metrics[0]["radius"]
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
            unblock_button=student_page.locator("#people-panel-list").get_by_role("button",name="Unblock")
            expect(unblock_button).to_be_visible()
            assert unblock_button.evaluate("el=>getComputedStyle(el).backgroundColor") in ("rgb(239, 248, 242)","rgb(38, 58, 50)")
            assert unblock_button.evaluate("el=>getComputedStyle(el).color")!="rgb(162, 63, 75)"
            unblock_button.click()
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
            zoom_before=float(student_page.locator("#photo-zoom").input_value())
            crop_box=student_page.locator("#photo-crop-canvas").bounding_box()
            scroll_before=student_page.evaluate("() => window.scrollY")
            student_page.mouse.move(crop_box["x"]+crop_box["width"]*.72,crop_box["y"]+crop_box["height"]*.5)
            student_page.mouse.wheel(0,-120)
            expect(student_page.locator("#photo-zoom")).not_to_have_value(str(zoom_before))
            assert float(student_page.locator("#photo-zoom").input_value())>zoom_before
            assert student_page.evaluate("() => window.scrollY")==scroll_before
            prior_photo_state=student_api.get(f"{base}/api/auth/me").json()
            def fail_photo_upload(route): route.abort()
            student_page.route(f"{base}/api/profile/photo",fail_photo_upload)
            student_page.locator("#photo-crop-confirm").click()
            expect(student_page.locator("#photo-edit-error")).not_to_be_empty()
            assert student_api.get(f"{base}/api/auth/me").json()["profile_photo_version"]==prior_photo_state["profile_photo_version"]
            expect(student_page.locator("#avatar")).to_have_attribute("data-avatar-source","photo")
            student_page.unroute(f"{base}/api/profile/photo",fail_photo_upload)
            student_page.locator("#photo-crop-confirm").click()
            expect(student_page.locator("#profile-saved")).to_contain_text("Your photo is saved and active.")
            expect(student_page.locator("#avatar")).to_have_attribute("data-avatar-source","photo")
            expect(student_page.locator("#avatar svg")).to_have_count(0)
            saved=student_api.get(f"{base}/api/profile/photo")
            assert saved.status==200 and Image.open(io.BytesIO(saved.body())).size==(512,512)
            original=student_api.get(f"{base}/api/profile/photo/original")
            assert original.status==200 and Image.open(io.BytesIO(original.body())).size==(1200,500)
            profile_state=student_api.get(f"{base}/api/auth/me").json()
            assert profile_state["profile_photo_version"] and profile_state["profile_photo_crop"]
            assert profile_state["active_avatar_source"]=="photo"
            version_after_use=profile_state["profile_photo_version"]
            student_page.wait_for_timeout(10000)
            expect(student_page.locator("#avatar")).to_have_attribute("data-avatar-source","photo")
            assert student_api.get(f"{base}/api/auth/me").json()["profile_photo_version"]==version_after_use
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
                action_metrics=student_page.locator(".profile-photo-actions button").evaluate_all("els=>els.map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el),g=el.firstElementChild.getBoundingClientRect(),t=el.lastElementChild.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,label:el.getAttribute('aria-label'),font:s.fontSize,weight:s.fontWeight,radius:s.borderRadius,contentCenter:(g.left+t.right)/2,buttonCenter:r.left+r.width/2}})")
                assert len(action_metrics)==4 and len({(item["width"],item["height"]) for item in action_metrics})==1
                assert all(not (a["left"]<b["right"] and a["right"]>b["left"] and a["top"]<b["bottom"] and a["bottom"]>b["top"]) for i,a in enumerate(action_metrics) for b in action_metrics[i+1:])
                assert [item["label"] for item in action_metrics]==["View","Edit","Upload","Remove"]
                assert all(abs(item["height"]-(42 if width==390 else 36))<=1 for item in action_metrics)
                assert all(abs(item["width"]-action_metrics[0]["width"])<0.1 and abs(item["height"]-action_metrics[0]["height"])<0.1 for item in action_metrics)
                assert len({(item["font"],item["weight"],item["radius"]) for item in action_metrics})==1
                assert all(abs(item["contentCenter"]-item["buttonCenter"])<3 for item in action_metrics), action_metrics
                assert student_page.locator(".profile-photo-actions").evaluate("el=>{const b=el.getBoundingClientRect();return [...el.children].every(x=>{const r=x.getBoundingClientRect();return r.left>=b.left&&r.right<=b.right&&r.top>=b.top&&r.bottom<=b.bottom})}")
                student_page.screenshot(path=str(screenshot_dir/f"profile-{width}-{theme}.png"))
                student_page.locator('#profile-dialog button[data-close="profile-dialog"]').last.click()
            student_page.locator("#account-button").click();student_page.locator("#profile-open").click()
            photo_panel=student_page.locator(".profile-photo-panel")
            photo_panel.evaluate("el=>{el.style.inlineSize='170px';el.style.maxInlineSize='170px'}")
            compact=student_page.locator(".profile-photo-actions button")
            expect(compact).to_have_count(4)
            assert compact.first.evaluate("el=>getComputedStyle(el.lastElementChild).position==='absolute'")
            assert all(compact.nth(index).get_attribute("aria-label")==label and compact.nth(index).get_attribute("title")==label for index,label in enumerate(("View","Edit","Upload","Remove")))
            compact_boxes=compact.evaluate_all("els=>els.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}})")
            assert len({(item["width"],item["height"]) for item in compact_boxes})==1
            assert all(not(a["left"]<b["right"] and a["right"]>b["left"] and a["top"]<b["bottom"] and a["bottom"]>b["top"]) for i,a in enumerate(compact_boxes) for b in compact_boxes[i+1:])
            student_page.screenshot(path=str(screenshot_dir/"profile-compact-icons.png"))
            student_page.locator('#profile-dialog button[data-close="profile-dialog"]').last.click()
            hidpi=browser.new_context(viewport={"width":390,"height":844},device_scale_factor=2)
            hidpi.set_default_timeout(5000)
            hidpi_page=hidpi.new_page();hidpi_page.goto(base)
            hidpi_page.locator("#auth-form input[name=email]").fill("student@example.edu")
            hidpi_page.locator("#auth-form input[name=password]").fill("study-together-123")
            hidpi_page.locator("#auth-submit").click()
            expect(hidpi_page.locator("#app-screen")).to_be_visible()
            hidpi_page.locator("#account-button").click();expect(hidpi_page.locator("#account-menu")).to_be_visible();hidpi_page.locator("#profile-open").click()
            for width in (390,1280,1600):
                hidpi_page.set_viewport_size({"width":width,"height":844 if width==390 else 900})
                metrics=hidpi_page.locator(".profile-photo-actions button").evaluate_all("els=>els.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}})")
                assert hidpi_page.evaluate("() => devicePixelRatio")==2
                assert len(metrics)==4 and len({(item["width"],item["height"]) for item in metrics})==1
                assert all(not (a["left"]<b["right"] and a["right"]>b["left"] and a["top"]<b["bottom"] and a["bottom"]>b["top"]) for i,a in enumerate(metrics) for b in metrics[i+1:])
            hidpi.close()
            for theme,expected_color in (("light","rgb(162, 63, 75)"),("dark","rgb(240, 167, 168)")):
                student_page.evaluate("theme => document.documentElement.dataset.theme=theme",theme)
                student_page.locator("#account-button").click()
                logout=student_page.locator("#logout-button")
                assert logout.evaluate("el=>getComputedStyle(el).color")==expected_color
                student_page.locator("#account-button").click()
            student_page.locator("#account-button").click()
            student_page.locator("#logout-button").click()
            signout=student_page.locator("#action-confirm-dialog")
            expect(signout).to_be_visible()
            expect(signout).to_contain_text("Sign out of StudyPilot?")
            signout.get_by_role("button",name="Cancel").click()
            expect(student_page.locator("#app-screen")).to_be_visible()
            expect(student_page.locator("#auth-screen")).to_be_hidden()
            student_page.locator("#account-button").click()
            student_page.locator("#logout-button").click()
            signout.get_by_role("button",name="Sign out").click()
            expect(student_page.locator("#app-screen")).to_be_hidden()
            expect(student_page.locator("#auth-screen")).to_be_visible()
    finally:
        server.should_exit=True
        thread.join(timeout=5)


def test_block_ownership_is_directional_and_updates_open_views(tmp_path, monkeypatch):
    import uvicorn

    monkeypatch.setenv("DB_PATH", str(tmp_path / "directional-block-browser.db"))
    monkeypatch.setenv("SESSION_SECRET", "directional-block-browser-key")
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
        with sync_playwright() as automation:
            browser = automation.chromium.launch()
            viewer = browser.new_context(viewport={"width":1280,"height":900})
            recipient = browser.new_context(viewport={"width":1280,"height":900})
            for context in (viewer, recipient):
                context.set_default_timeout(10000)
            for context, email, username, name in (
                (viewer,"viewer@example.edu","viewer","Viewer"),
                (recipient,"recipient@example.edu","recipient","Recipient"),
            ):
                response=context.request.post(f"{base}/api/auth/register",data={"email":email,"username":username,"name":name,"password":"study-together-123"})
                assert response.ok,response.text()
            viewer_api,recipient_api=viewer.request,recipient.request
            oversized=viewer_api.post(f"{base}/api/profile/photo",multipart={"photo":{"name":"oversized.png","mimeType":"image/png","buffer":b"x"*(5*1024*1024+1)}})
            assert oversized.status==413
            assert viewer_api.post(f"{base}/api/friend-requests",data={"username":"recipient"}).ok
            request=recipient_api.get(f"{base}/api/friend-requests").json()[0]
            assert recipient_api.post(f"{base}/api/friend-requests/{request['id']}/accept").ok
            project=viewer_api.post(f"{base}/api/projects",data={"name":"Directional block group","description":"","avatar":"violet"}).json()
            assert recipient_api.post(f"{base}/api/projects/join-requests",data={"code":project["join_code"]}).ok
            join_request=viewer_api.get(f"{base}/api/projects/{project['id']}/join-requests").json()[0]
            assert viewer_api.post(f"{base}/api/projects/{project['id']}/join-requests/{join_request['id']}/approve").ok
            conversation=viewer_api.post(f"{base}/api/direct/conversations",data={"recipient_id":2}).json()

            viewer_people=viewer.new_page();viewer_people.goto(f"{base}/#/people")
            viewer_people.locator("#people-tabs").get_by_role("button",name="Friends 1").click()
            viewer_people.locator("#people-panel-list .profile-name-trigger").click()
            viewer_profile=viewer_people.locator("#classmate-profile-dialog")
            expect(viewer_profile.get_by_role("button",name="Block Recipient")).to_be_visible()
            viewer_group=viewer.new_page();viewer_group.goto(f"{base}/#/groups/{project['id']}")
            viewer_group.locator(".member-profile-trigger").filter(has_text="Recipient").click()
            group_profile=viewer_group.locator("#classmate-profile-dialog")
            expect(group_profile.get_by_role("button",name="Block Recipient")).to_be_visible()

            recipient_people=recipient.new_page();recipient_people.goto(f"{base}/#/people")
            recipient_people.locator("#people-tabs").get_by_role("button",name="Friends 1").click()
            recipient_people.locator("#people-panel-list .profile-name-trigger").click()
            recipient_profile=recipient_people.locator("#classmate-profile-dialog")
            recipient_messages=recipient.new_page();recipient_messages.goto(f"{base}/#/messages")
            recipient_messages.locator("#conversation-tab-direct").click()
            expect(recipient_messages.locator(".conversation-item")).to_have_count(1)
            recipient_messages.locator(".conversation-item").click()
            recipient_status=recipient_messages.locator(".direct-composer-status")

            # One directional block: only its owner can remove it.
            assert viewer_api.post(f"{base}/api/people/2/block").ok
            viewer_state=viewer_api.get(f"{base}/api/people/2").json()
            recipient_state=recipient_api.get(f"{base}/api/people/1").json()
            assert (viewer_state["blocked_by_me"],viewer_state["blocked_me"])==(True,False)
            assert (recipient_state["blocked_by_me"],recipient_state["blocked_me"])==(False,True)
            assert recipient_api.delete(f"{base}/api/people/1/block").status==404
            expect(viewer_profile.get_by_role("button",name="Unblock Recipient")).to_be_visible(timeout=10000)
            expect(group_profile.get_by_role("button",name="Unblock Recipient")).to_be_visible(timeout=10000)
            viewer_profile.get_by_role("button",name="Close").click()
            expect(viewer_people.locator("#people-tabs").get_by_role("button",name="Blocked 1")).to_be_visible(timeout=10000)
            viewer_people.locator("#people-tabs").get_by_role("button",name="Blocked 1").click()
            viewer_people.locator("#people-panel-list .profile-name-trigger").click()
            viewer_profile=viewer_people.locator("#classmate-profile-dialog")
            group_profile.get_by_role("button",name="Close").click()
            group_menu=viewer_group.locator(".member-row").filter(has_text="Recipient").locator(".member-actions-menu")
            group_menu.locator("summary").click()
            unavailable_group_message=group_menu.get_by_role("button",name="Messaging unavailable")
            expect(unavailable_group_message).to_be_disabled(timeout=10000)
            group_menu.evaluate("el=>el.open=false")
            viewer_group.locator(".member-profile-trigger").filter(has_text="Recipient").click()
            group_profile=viewer_group.locator("#classmate-profile-dialog")
            expect(recipient_profile).to_contain_text("Messaging is unavailable with this classmate",timeout=10000)
            expect(recipient_profile.get_by_role("button",name="Unblock Viewer")).to_have_count(0)
            expect(recipient_status).to_contain_text("Messaging is unavailable with this classmate",timeout=10000)
            expect(recipient_status.get_by_role("button",name="Unblock this classmate")).to_have_count(0)
            expect(recipient_messages.get_by_role("textbox",name="Private message")).to_be_hidden()
            assert recipient_api.post(f"{base}/api/direct/conversations/{conversation['id']}/messages",data={"body":"blocked"}).status==403

            # Reciprocal blocks remain independent, and each person can remove only their own.
            assert recipient_api.post(f"{base}/api/people/1/block").ok
            viewer_state=viewer_api.get(f"{base}/api/people/2").json()
            recipient_state=recipient_api.get(f"{base}/api/people/1").json()
            assert (viewer_state["blocked_by_me"],viewer_state["blocked_me"])==(True,True)
            assert (recipient_state["blocked_by_me"],recipient_state["blocked_me"])==(True,True)
            expect(recipient_profile.get_by_role("button",name="Unblock Viewer")).to_be_visible(timeout=10000)
            assert viewer_api.delete(f"{base}/api/people/2/block").status==204
            viewer_state=viewer_api.get(f"{base}/api/people/2").json()
            assert (viewer_state["blocked_by_me"],viewer_state["blocked_me"])==(False,True)
            expect(viewer_profile.get_by_role("button",name="Unblock Recipient")).to_have_count(0,timeout=10000)
            expect(group_profile.get_by_role("button",name="Unblock Recipient")).to_have_count(0,timeout=10000)
            assert viewer_api.delete(f"{base}/api/people/2/block").status==404
            assert viewer_api.post(f"{base}/api/direct/conversations/{conversation['id']}/messages",data={"body":"still blocked"}).status==403

            # Once both remove their own block, old friendships still require a fresh request.
            assert recipient_api.delete(f"{base}/api/people/1/block").status==204
            for api,other_id in ((viewer_api,2),(recipient_api,1)):
                state=api.get(f"{base}/api/people/{other_id}").json()
                assert not state["blocked_by_me"] and not state["blocked_me"]
                assert state["needs_friend_request"] and not state["can_message"]
            assert viewer_api.post(f"{base}/api/direct/conversations/{conversation['id']}/messages",data={"body":"reconnect first"}).status==403
    finally:
        server.should_exit = True
        thread.join(timeout=5)
