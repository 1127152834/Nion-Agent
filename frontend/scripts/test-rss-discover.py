"""Test RSS discover page after UI changes."""
from playwright.sync_api import sync_playwright

def main():
    errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # Capture console errors
        def handle_console(msg):
            if msg.type == 'error':
                text = msg.text
                if 'favicon' not in text.lower() and 'manifest' not in text.lower():
                    errors.append(f"Console error: {text}")

        page.on('console', handle_console)

        # Capture page errors
        def handle_page_error(err):
            errors.append(f"Page error: {err}")

        page.on('pageerror', handle_page_error)

        # Test: RSS discover page
        print("Testing RSS discover page...")
        page.goto('http://localhost:3000/workspace/rss/discover')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(3000)

        # Take screenshot
        page.screenshot(path='/tmp/rss-discover.png', full_page=True)
        print(f"  Screenshot saved to /tmp/rss-discover.png")

        browser.close()

    # Report results
    print("\n" + "="*50)
    if errors:
        print("ERRORS FOUND:")
        for err in errors:
            print(f"  - {err}")
    else:
        print("SUCCESS: No JavaScript errors found!")
    print("="*50)

if __name__ == '__main__':
    main()
