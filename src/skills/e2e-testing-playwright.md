# Skill: E2E Testing with Playwright

This skill guides developers and AI agents on how to construct, execute, and verify automated End-to-End tests in the Media Center using Playwright.

---

## 📋 Overview

E2E tests simulate actual user interactions (clicking, typing, streaming) to guarantee that core subsystems (Explorer, Home Control, authentication, and the AI Chat sidebar) remain intact after code modifications.

---

## 🛠️ Step-by-Step Instructions

### Step 1: Install Playwright
Install the Playwright test suite and required browsers inside the project root:
```bash
# Add Playwright Test framework
npm install -D @playwright/test

# Install browser binaries
npx playwright install
```

### Step 2: Configure E2E environment
Create a `playwright.config.js` file in the root directory to define test environments, local ports, and base URLs:
```javascript
// playwright.config.js
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  expect: { timeout: 5000 },
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5555',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm start',
    url: 'http://localhost:5555',
    reuseExistingServer: !process.env.CI,
  },
});
```

### Step 3: Write a Test Case
Create E2E test files inside the `/tests` folder. Ensure selectors target unique classes or ARIA attributes:

```javascript
// tests/auth.spec.js
const { test, expect } = require('@playwright/test');

test.describe('Login & Navigation Flow', () => {
  test('should login successfully with correct credentials', async ({ page }) => {
    // Navigate to homepage (which redirects to login if auth is enabled)
    await page.goto('/');

    // Fill in the login credentials
    await page.fill('input[name="username"]', 'admin');
    await page.fill('input[name="password"]', '@123456789');
    await page.click('button[type="submit"]');

    // Should redirect to dashboard
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator('.logo-text')).toContainText('Black Bird');
  });

  test('should display chat AI sidebar when toggle button is clicked', async ({ page }) => {
    // Login first (or session is retained)
    await page.goto('/dashboard');

    // Verify Chat AI toggle button exists in header submenu
    const toggleBtn = page.locator('#sidebarChatToggleBtn');
    await expect(toggleBtn).toBeVisible();

    // Toggle the sidebar open
    await toggleBtn.click();

    // Verify sidebar is active and visible
    const sidebar = page.locator('#aiChatSidebar');
    await expect(sidebar).toHaveClass(/show/);

    // Send a message and wait for Llama response
    await page.fill('#aiChatSidebarInput', 'Olá, quem é você?');
    await page.press('#aiChatSidebarInput', 'Enter');

    // Wait for incoming typing indicator to vanish and reply bubble to show up
    await page.waitForSelector('.ai-message.incoming');
    const lastMsg = page.locator('.ai-message.incoming >> last');
    await expect(lastMsg).toBeVisible();
  });
});
```

---

## 🚀 Execution & Verification

Run tests using the following command lines:

```bash
# Run all tests headlessly
npx playwright test

# Run tests in headed UI mode (great for visual inspection)
npx playwright test --ui

# Debug a specific test file
npx playwright test tests/auth.spec.js --debug
```

---

## 💡 Best Practices

1. **Keep State Isolated**: Clean up modified configurations, user directories, or favorites records inside the database (`src/datacache/`) after running test specs.
2. **Handle Animations**: Playwright automatically waits for elements to be actionable, but for custom CSS slide-ins (like the AI sidebar drawer), assert layout changes *after* transition durations (e.g., `.show` class presence).
3. **Use Mock Routes**: Mock out the Hugging Face AI response if testing chat interface stability without consuming actual HF serverless tokens.
