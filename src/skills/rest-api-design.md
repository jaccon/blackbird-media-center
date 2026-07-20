# Skill: REST API Design & Implementation

This skill defines the development guidelines, standards, and patterns for adding or modifying REST API endpoints within `server.js`.

---

## 📋 Overview

REST API endpoints in the Media Center serve data to frontend dashboards, home controls, and the chat client. Adhering to structured patterns ensures all routes are safe, fast, validated, and uniform.

---

## 📐 Standards & Rules

### 1. Consistent Response JSON Schema
All API routes must return a standard wrapper object:

* **On Success**: `200 OK`
  ```json
  {
    "success": true,
    "data": { ... }
  }
  ```
* **On Error**: appropriate `4xx`/`5xx` status code
  ```json
  {
    "success": false,
    "error": "Short descriptive error message explaining the failure."
  }
  ```

### 2. Status Code Selection
* `200 OK`: Successful resource retrieval or update.
* `201 Created`: Successful creation of files, directories, or configs.
* `400 Bad Request`: Missing mandatory body parameters or invalid input format.
* `401 Unauthorized`: Missing or invalid authentication cookie/token.
* `403 Forbidden`: Insufficient permissions (e.g. non-admin trying to edit users).
* `404 Not Found`: Resource or path does not exist.
* `500 Internal Server Error`: Unhandled database file system writes or server faults.

---

## 💡 Code Patterns & Examples

Below is a template showing validation, async error handling, and file system safety:

```javascript
// Example: Adding/Updating a favorite item in datacache/favorites.json
app.post('/api/favorites/add', express.json(), async (req, res) => {
    const { mediaId, title, path } = req.body;

    // 1. Authorization check
    if (config.authEnabled && !req.cookies.authenticated) {
        return res.status(401).json({ success: false, error: 'Unauthorized session.' });
    }

    // 2. Input validation
    if (!mediaId || !title || !path) {
        return res.status(400).json({ 
            success: false, 
            error: 'Missing required parameters: mediaId, title, or path.' 
        });
    }

    try {
        // 3. Thread-safe JSON write
        const favoritesFile = path.join(DATACACHE_DIR, 'favorites.json');
        let favorites = [];
        
        if (fs.existsSync(favoritesFile)) {
            favorites = await fs.readJson(favoritesFile);
        }

        // Avoid duplication
        if (favorites.some(fav => fav.id === mediaId)) {
            return res.status(200).json({ success: true, message: 'Already in favorites.' });
        }

        favorites.push({ id: mediaId, title, path, addedAt: new Date().toISOString() });
        
        // Atomic write
        await fs.writeJson(favoritesFile, favorites, { spaces: 2 });

        return res.status(201).json({ success: true, data: { favorites } });

    } catch (error) {
        console.error('[API Favorites Add Error]:', error);
        
        // Return 500 status on unexpected server exceptions
        return res.status(500).json({ 
            success: false, 
            error: 'Failed to write record to local database.' 
        });
    }
});
```

---

## 🛡️ Security Guidelines

* **Sanitize Inputs**: Always sanitize text fields targeting bash execution or paths. Avoid passing user inputs directly into `exec()` or `spawn()` child shell calls.
* **Path Traversal Prevention**: When retrieving or writing files based on a client path, sanitize it to prevent directory traversal outside `public/shared/` or standard config dirs:
  ```javascript
  const safePath = path.normalize(userInputPath).replace(/^(\.\.(\/|\\|$))+/, '');
  ```
* **Cookie Isolation**: Keep the session authentication cookie flag `httpOnly: true` and `sameSite: 'strict'` to prevent cross-site request forgery.
