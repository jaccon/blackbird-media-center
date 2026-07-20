require('dotenv').config(); // Carrega as variáveis do .env
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const net = require('net');
const https = require('https');
const http = require('http');
const multer = require('multer');
const AdmZip = require('adm-zip');

function customFetch(url, options = {}) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const protocol = parsedUrl.protocol === 'https:' ? https : http;
        
        const reqOptions = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: options.method || 'GET',
            headers: options.headers || {},
            timeout: options.timeout || 10000
        };
        
        const req = protocol.request(reqOptions, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                resolve({
                    ok: res.statusCode >= 200 && res.statusCode < 300,
                    status: res.statusCode,
                    statusText: res.statusMessage,
                    text: () => Promise.resolve(data),
                    json: () => {
                        try {
                            return Promise.resolve(JSON.parse(data));
                        } catch (e) {
                            return Promise.reject(new Error("Resposta JSON inválida: " + data));
                        }
                    }
                });
            });
        });
        
        req.on('error', (err) => {
            reject(err);
        });
        
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request Timeout'));
        });
        
        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

const fetch = customFetch;

const app = express();

const PORT = process.env.PORT || 5555;
const SHARED_DIR = process.env.SHARED_DIR || 'public/shared';

// Função para recuperar o endereço IP local na rede Wi-Fi/Ethernet
function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

// Configuração do FFmpeg estático para transcoding de MKV
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

// Bancos de dados em arquivo JSON
const DATACACHE_DIR = path.join(__dirname, 'datacache');
fs.ensureDirSync(DATACACHE_DIR);

const BACKUPS_DIR = path.join(DATACACHE_DIR, 'backups');
fs.ensureDirSync(BACKUPS_DIR);

// Função auxiliar para migrar arquivos antigos da raiz para a pasta datacache
function migrateToDatacache(filename) {
    const oldPath = path.join(__dirname, filename);
    const newPath = path.join(DATACACHE_DIR, filename);
    if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
        try {
            fs.moveSync(oldPath, newPath);
            console.log(`Migrado banco de dados: ${filename} para datacache/`);
        } catch (e) {
            console.error(`Erro ao migrar ${filename}:`, e);
        }
    }
}

// Executar migrações
migrateToDatacache('cameras.json');
migrateToDatacache('favorites.json');
migrateToDatacache('history.json');
migrateToDatacache('hidden_files.json');
migrateToDatacache('password.json');

let cameras = [];
const CAMERAS_FILE = path.join(DATACACHE_DIR, 'cameras.json');
try {
    if (fs.existsSync(CAMERAS_FILE)) {
        cameras = fs.readJsonSync(CAMERAS_FILE);
    } else {
        cameras = [
            { name: "Câmera Entrada", url: "rtsp://192.168.1.100:554/stream1" },
            { name: "Câmera Garagem", url: "rtsp://192.168.1.101:554/stream1" }
        ];
        fs.writeJsonSync(CAMERAS_FILE, cameras, { spaces: 2 });
    }
} catch (e) {
    console.error("Erro ao ler cameras.json:", e);
}

let favorites = [];
const FAVORITES_FILE = path.join(DATACACHE_DIR, 'favorites.json');
try {
    if (fs.existsSync(FAVORITES_FILE)) {
        favorites = fs.readJsonSync(FAVORITES_FILE);
    } else {
        favorites = [];
        fs.writeJsonSync(FAVORITES_FILE, favorites, { spaces: 2 });
    }
} catch (e) {
    console.error("Erro ao ler favorites.json:", e);
}

let historyList = [];
const HISTORY_FILE = path.join(DATACACHE_DIR, 'history.json');
try {
    if (fs.existsSync(HISTORY_FILE)) {
        historyList = fs.readJsonSync(HISTORY_FILE);
    } else {
        fs.writeJsonSync(HISTORY_FILE, historyList, { spaces: 2 });
    }
} catch (e) {
    console.error("Erro ao ler history.json:", e);
}

let hiddenFiles = [];
const HIDDEN_FILES_FILE = path.join(DATACACHE_DIR, 'hidden_files.json');
try {
    if (fs.existsSync(HIDDEN_FILES_FILE)) {
        hiddenFiles = fs.readJsonSync(HIDDEN_FILES_FILE);
    } else {
        fs.writeJsonSync(HIDDEN_FILES_FILE, hiddenFiles, { spaces: 2 });
    }
} catch (e) {
    console.error("Erro ao ler hidden_files.json:", e);
}

let hiddenPassword = process.env.HIDDEN_PASSWORD || '1234';
const PASSWORD_FILE = path.join(DATACACHE_DIR, 'password.json');
try {
    if (fs.existsSync(PASSWORD_FILE)) {
        const data = fs.readJsonSync(PASSWORD_FILE);
        if (data && data.password) {
            hiddenPassword = data.password;
        }
    } else {
        fs.writeJsonSync(PASSWORD_FILE, { password: hiddenPassword }, { spaces: 2 });
    }
} catch (e) {
    console.error("Erro ao ler/escrever password.json:", e);
}

// Configuração do Sistema (Configurações Gerais de Autenticação e Upload)
const CONFIG_FILE = path.join(DATACACHE_DIR, 'config.json');
let config = {
    authEnabled: false,
    loginPassword: 'admin',
    allowedExtensions: '.mp4, .mp3, .jpg, .png, .mkv, .avi, .jpeg, .gif, .wav',
    language: 'en',
    appAddress: '',
    hfToken: process.env.HF_TOKEN || '',
    schedulerInterval: 10,
    schedulerCheckFeatures: true,
    schedulerCheckTasks: true,
    schedulerCheckReminders: true,
    limitAlertsOncePerDay: true,
    telegramBotEnabled: false,
    telegramBotToken: '',
    telegramAllowedUsers: '',
    layoutFullWidth: false
};
try {
    if (fs.existsSync(CONFIG_FILE)) {
        const data = fs.readJsonSync(CONFIG_FILE);
        config = { ...config, ...data };
    } else {
        // Se config.json não existia, usamos hiddenPassword como loginPassword padrão
        config.loginPassword = hiddenPassword;
        fs.writeJsonSync(CONFIG_FILE, config, { spaces: 2 });
    }
} catch (e) {
    console.error("Erro ao ler/escrever config.json:", e);
}

// Banco de dados de usuários
const USERS_FILE = path.join(DATACACHE_DIR, 'users.json');
let users = [];

function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            users = fs.readJsonSync(USERS_FILE);
        } else {
            // Criar usuário admin padrão usando a senha configurada
            users = [{
                username: 'admin',
                password: config.loginPassword || 'admin',
                group: 'admin'
            }];
            saveUsers();
        }
        // Garantir que todos os usuários (incluindo admin) tenham sua pasta home criada
        users.forEach(u => {
            const userDir = path.join(__dirname, SHARED_DIR, 'users', u.username);
            try {
                fs.ensureDirSync(userDir);
            } catch (err) {
                console.error(`Erro ao criar pasta home para ${u.username}:`, err);
            }
        });
    } catch (e) {
        console.error("Erro ao carregar usuários:", e);
        users = [];
    }
}

function saveUsers() {
    try {
        fs.writeJsonSync(USERS_FILE, users, { spaces: 2 });
    } catch (e) {
        console.error("Erro ao salvar usuários.json:", e);
    }
}

// Carregar usuários inicialmente
loadUsers();

// Banco de dados de dispositivos inteligentes (Home Control / Alexa Mock)
const DEVICES_FILE = path.join(DATACACHE_DIR, 'devices.json');
let devices = [
    { id: 'light_living', name: 'Luz Sala', type: 'light', state: 'off', brightness: 70 },
    { id: 'light_kitchen', name: 'Luz Cozinha', type: 'light', state: 'off', brightness: 100 },
    { id: 'light_bedroom', name: 'Luz Quarto', type: 'light', state: 'off', brightness: 50 },
    { id: 'air_cond', name: 'Ar Condicionado', type: 'ac', state: 'off', temperature: 22 },
    { id: 'smart_tv', name: 'Smart TV', type: 'outlet', state: 'off' }
];

function loadDevices() {
    try {
        if (fs.existsSync(DEVICES_FILE)) {
            devices = fs.readJsonSync(DEVICES_FILE);
        } else {
            fs.writeJsonSync(DEVICES_FILE, devices, { spaces: 2 });
        }
    } catch (e) {
        console.error("Erro ao carregar devices.json:", e);
    }
}

function saveDevices() {
    try {
        fs.writeJsonSync(DEVICES_FILE, devices, { spaces: 2 });
    } catch (e) {
        console.error("Erro ao salvar devices.json:", e);
    }
}

// Carregar dispositivos inicialmente
loadDevices();

// Histórico de conversas do Chat AI (Sessões/Threads)
const CHAT_HISTORY_FILE = path.join(DATACACHE_DIR, 'chat_history.json');
let chatHistory = {
    currentSessionId: 'default',
    sessions: {
        'default': {
            id: 'default',
            title: 'Conversa Geral',
            timestamp: new Date().toISOString(),
            messages: []
        }
    }
};

function loadChatHistory() {
    try {
        if (fs.existsSync(CHAT_HISTORY_FILE)) {
            const data = fs.readJsonSync(CHAT_HISTORY_FILE);
            if (Array.isArray(data)) {
                // Migrar antigo flat
                chatHistory = {
                    currentSessionId: 'default',
                    sessions: {
                        'default': {
                            id: 'default',
                            title: 'Conversa Geral',
                            timestamp: new Date().toISOString(),
                            messages: data
                        }
                    }
                };
                saveChatHistory();
            } else {
                chatHistory = data;
            }
        } else {
            fs.writeJsonSync(CHAT_HISTORY_FILE, chatHistory, { spaces: 2 });
        }
    } catch (e) {
        console.error("Erro ao carregar chat_history.json:", e);
    }
}

function saveChatHistory() {
    try {
        fs.writeJsonSync(CHAT_HISTORY_FILE, chatHistory, { spaces: 2 });
    } catch (e) {
        console.error("Erro ao salvar chat_history.json:", e);
    }
}

// Carregar histórico inicialmente
loadChatHistory();

// Banco de dados de Agentes de AI
const AGENTS_FILE = path.join(DATACACHE_DIR, 'agents.json');
let agentsList = [];

function loadAgents() {
    try {
        if (fs.existsSync(AGENTS_FILE)) {
            agentsList = fs.readJsonSync(AGENTS_FILE);
        } else {
            agentsList = [
                {
                    id: 'agent_default',
                    name: config.agentName || 'Assistente Inteligente',
                    profile: 'Suporte e Mídias',
                    skills: config.agentSkills || 'Especialista em recomendação de mídias, automação residencial e suporte técnico geral.',
                    model: config.agentModel || 'meta-llama/Llama-3.1-8B-Instruct',
                    temperature: config.agentTemperature !== undefined ? config.agentTemperature : 0.7,
                    isPublic: true,
                    isProactive: true
                }
            ];
            fs.writeJsonSync(AGENTS_FILE, agentsList, { spaces: 2 });
        }
    } catch (e) {
        console.error("Erro ao carregar agents.json:", e);
    }
}

function saveAgents() {
    try {
        fs.writeJsonSync(AGENTS_FILE, agentsList, { spaces: 2 });
    } catch (e) {
        console.error("Erro ao salvar agents.json:", e);
    }
}

// Carregar agentes inicialmente
loadAgents();

// Banco de dados de Notas (Notes / Lembretes)
const NOTES_FILE = path.join(DATACACHE_DIR, 'notes.json');
let notesList = [];

function loadNotes() {
    try {
        if (fs.existsSync(NOTES_FILE)) {
            notesList = fs.readJsonSync(NOTES_FILE);
        } else {
            notesList = [
                {
                    id: 'note_default_1',
                    title: 'Welcome to Notes!',
                    content: 'This space serves as a dual read/write channel for you and your AI agents. Ask proactive agents (like Morpheu) to write workout plans or diets for you here!',
                    createdBy: 'System',
                    agentId: null,
                    timestamp: new Date().toISOString()
                }
            ];
            fs.writeJsonSync(NOTES_FILE, notesList, { spaces: 2 });
        }
    } catch (e) {
        console.error("Erro ao carregar notes.json:", e);
    }
}

function saveNotes() {
    try {
        fs.writeJsonSync(NOTES_FILE, notesList, { spaces: 2 });
    } catch (e) {
        console.error("Erro ao salvar notes.json:", e);
    }
}

async function saveNotesAsync() {
    try {
        await fs.writeJson(NOTES_FILE, notesList, { spaces: 2 });
    } catch (e) {
        console.error("Erro ao salvar notes.json assincronamente:", e);
    }
}

// Carregar notas inicialmente
loadNotes();

// Banco de dados de Notificações do Sistema (Alertas do Chat AI)
const NOTIFICATIONS_FILE = path.join(DATACACHE_DIR, 'notifications.json');
let notifications = [];

function loadNotifications() {
    try {
        if (fs.existsSync(NOTIFICATIONS_FILE)) {
            notifications = fs.readJsonSync(NOTIFICATIONS_FILE);
        } else {
            notifications = [];
            fs.writeJsonSync(NOTIFICATIONS_FILE, notifications, { spaces: 2 });
        }
    } catch (e) {
        console.error("Erro ao carregar notifications.json:", e);
    }
}

function saveNotifications() {
    try {
        fs.writeJsonSync(NOTIFICATIONS_FILE, notifications, { spaces: 2 });
    } catch (e) {
        console.error("Erro ao salvar notifications.json:", e);
    }
}

// Carregar notificações inicialmente
loadNotifications();

// Banco de dados de tarefas (Tasks / Kanban Board organizado por projetos)
const TASKS_FILE = path.join(DATACACHE_DIR, 'tasks.json');
let tasksData = {
    projects: {
        'proj_default': {
            id: 'proj_default',
            name: 'Projeto Principal',
            description: 'Quadro de tarefas geral do sistema BlackBird.',
            columns: {
                todo: { id: 'todo', title: 'To Do', cards: [] },
                doing: { id: 'doing', title: 'Doing', cards: [] },
                validation: { id: 'validation', title: 'Validation', cards: [] },
                done: { id: 'done', title: 'Done', cards: [] }
            }
        }
    }
};

function loadTasks() {
    try {
        if (fs.existsSync(TASKS_FILE)) {
            tasksData = fs.readJsonSync(TASKS_FILE);
            // Garantir retrocompatibilidade caso o arquivo tasks.json antigo estivesse ativo
            if (!tasksData.projects) {
                const oldColumns = tasksData.columns || {
                    todo: { id: 'todo', title: 'To Do', cards: [] },
                    doing: { id: 'doing', title: 'Doing', cards: [] },
                    validation: { id: 'validation', title: 'Validation', cards: [] },
                    done: { id: 'done', title: 'Done', cards: [] }
                };
                tasksData = {
                    projects: {
                        'proj_default': {
                            id: 'proj_default',
                            name: 'Projeto Principal',
                            description: 'Quadro de tarefas geral do sistema BlackBird.',
                            columns: oldColumns
                        }
                    }
                };
                fs.writeJsonSync(TASKS_FILE, tasksData, { spaces: 2 });
            }
        } else {
            // Seed a few example cards
            tasksData.projects['proj_default'].columns.todo.cards.push({
                id: 'task_1',
                title: 'Estudar Arquitetura',
                description: 'Revisar os princípios de design do Media Center e a estrutura de pastas.',
                category: 'Estudo',
                labels: ['Importante', 'Documentação'],
                dueDate: '2026-07-20',
                mtime: new Date().toISOString()
            });
            tasksData.projects['proj_default'].columns.doing.cards.push({
                id: 'task_2',
                title: 'Implementar Player de Audio',
                description: 'Adicionar player de áudio compatível com HLS na view de biblioteca.',
                category: 'Desenvolvimento',
                labels: ['Urgente'],
                dueDate: '2026-07-01',
                mtime: new Date().toISOString()
            });
            fs.writeJsonSync(TASKS_FILE, tasksData, { spaces: 2 });
        }
    } catch (e) {
        console.error("Erro ao carregar tasks.json:", e);
    }
}

function saveTasks() {
    try {
        fs.writeJsonSync(TASKS_FILE, tasksData, { spaces: 2 });
    } catch (e) {
        console.error("Erro ao salvar tasks.json:", e);
    }
}

async function saveTasksAsync() {
    try {
        await fs.writeJson(TASKS_FILE, tasksData, { spaces: 2 });
    } catch (e) {
        console.error("Erro ao salvar tasks.json assincronamente:", e);
    }
}

// Carregar tarefas inicialmente
loadTasks();

// Garantir sincronia completa no início
hiddenPassword = config.loginPassword;
try {
    fs.writeJsonSync(PASSWORD_FILE, { password: hiddenPassword }, { spaces: 2 });
} catch (e) {}

// Helper to parse cookies from request
function getCookies(req) {
    const cookieHeader = req.headers.cookie || '';
    if (!cookieHeader) return {};
    return Object.fromEntries(cookieHeader.split('; ').map(c => {
        const parts = c.split('=');
        return [parts[0], decodeURIComponent(parts[1] || '')];
    }));
}

// Helper to check if a user is authorized to access a filesystem path
function isPathAllowed(req, filePath) {
    if (!config.authEnabled) return true;

    const cookies = getCookies(req);
    const username = cookies.username;
    const group = cookies.userGroup;

    // Admin has access to everything
    if (group === 'admin') return true;

    // Default: if no username is set, restrict access
    if (!username) return false;

    // Normalize path to prevent directory traversal
    const cleanPath = path.normalize(filePath || '').replace(/\\/g, '/');

    // Prevent traversing up
    if (cleanPath.startsWith('..') || path.isAbsolute(cleanPath)) return false;

    const userPrefix = `users/${username}/`;
    const userPrefixNoSlash = `users/${username}`;

    return cleanPath.startsWith(userPrefix) || cleanPath === userPrefixNoSlash;
}

// Helper to construct the physical base folder path for a user
function getAuthorizedPath(req, inputPath) {
    const cookies = getCookies(req);
    const username = cookies.username || '';

    if (!config.authEnabled || !username) {
        return inputPath || '';
    }

    let cleanPath = (inputPath || '').replace(/\\/g, '/');
    const userPrefix = `users/${username}/`;
    const userPrefixNoSlash = `users/${username}`;

    if (!cleanPath.startsWith(userPrefix) && cleanPath !== userPrefixNoSlash) {
        // Prepend user folder prefix (home directory)
        cleanPath = cleanPath ? `users/${username}/${cleanPath}` : `users/${username}`;
    }

    return path.normalize(cleanPath).replace(/\\/g, '/');
}

// Middleware de Autenticação Global
function authMiddleware(req, res, next) {
    // Make config globally available in views
    res.locals.config = config;

    // Se a autenticação global não estiver ativa, prossegue
    if (!config.authEnabled) {
        res.locals.username = '';
        res.locals.userGroup = 'admin'; // Se auth desativada, assume admin
        req.username = '';
        req.userGroup = 'admin';
        return next();
    }

    // Rotas públicas que não requerem autenticação
    const publicPaths = ['/login', '/login/auth', '/upload-chunk', '/css', '/js', '/images', '/favicon.ico'];
    const isPublic = publicPaths.some(p => req.path.startsWith(p));
    if (isPublic) {
        return next();
    }

    // Verificar se o usuário está autenticado
    const cookies = getCookies(req);
    if (cookies.authenticated === 'true') {
        req.username = cookies.username || '';
        req.userGroup = cookies.userGroup || 'customer';
        res.locals.username = req.username;
        res.locals.userGroup = req.userGroup;

        // Se for acesso aos arquivos estáticos do shared, valida se o path é permitido
        if (req.path.startsWith('/shared/')) {
            const relFilePath = decodeURIComponent(req.path.substring('/shared/'.length));
            if (!isPathAllowed(req, relFilePath)) {
                return res.status(403).send('Forbidden: Você não tem permissão para acessar este arquivo.');
            }
        }
        return next();
    }

    // Redireciona para o login salvando a URL original para retorno pós-login
    res.redirect(`/login?redirectTo=${encodeURIComponent(req.originalUrl || req.url)}`);
}

let promptHistory = [];

// Configuração do EJS como template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Dicionário de Traduções (Inglês padrão, Português e Espanhol)
const translations = {
    en: {
        username: "Username",
        invalid_credentials: "Incorrect username or password.",
        dashboard: "Dashboard",
        explorer: "Explorer",
        files: "Files",
        notes: "Notes",
        videos: "Videos",
        photos: "Photos",
        music: "Music",
        cameras: "Cameras",
        favorites: "Favorites",
        settings: "Settings",
        logout: "Logout",
        image: "Image",
        video_label: "Video",
        actions: "Actions",
        name: "Name",
        size: "Size",
        total: "total",
        system_status: "System Status & Dashboard",
        overview_space: "Overview of storage space, recent media and database",
        recently_played: "Recently Played Videos",
        no_recent_videos: "No recently played videos.",
        latest_uploads: "Recently Added Files",
        no_files_shared: "No files found in shared folder.",
        mobile_access: "Mobile Access",
        scan_qr: "Point your mobile camera to open Media Center",
        database_jsons: "Database (JSONs)",
        database_desc: "Security camera configuration and favorite history data are stored locally in text files in JSON format.",
        cameras_size: "Cameras (cameras.json)",
        favorites_size: "Favorites (favorites.json)",
        total_db_size: "Total DB Size:",
        shared_folder_space: "Shared Folder Space",
        shared_folder_desc: "All uploaded or copied media files are indexed and available in the server's public shared files directory.",
        total_files: "Total Files",
        space_used: "Space Used",
        server_path: "Server Path:",
        disk_distribution: "Disk Usage Distribution",
        empty_folder: "Empty folder",
        other: "Other",
        others: "Others",
        search_placeholder: "Search files...",
        search_results: "Global search results for:",
        clear_search: "Clear Search",
        select_files_upload: "Select files for upload",
        click_select_files: "Click to select files",
        media_upload_root: "Uploaded media will be available at root",
        any_media_supported: "Any media file is supported",
        selected_files: "Selected",
        upload_files: "Upload Files",
        cancel: "Cancel",
        send: "Send",
        create_folder: "Create New Folder",
        folder_name: "Folder Name",
        hidden_folder_opt: "Keep this folder hidden (requires password to view)",
        create: "Create",
        list_view: "List",
        grid_view: "Grid",
        slideshow_view: "Slideshow",
        no_files_found: "No files found",
        no_files_found_desc: "No files were found in this directory.",
        no_favorites_saved: "No favorites saved",
        no_favorites_desc: "Favorite files on Home by clicking the star to make them appear here.",
        explore_files: "Explore Files",
        download: "Download",
        hide: "Hide",
        show: "Show",
        delete: "Delete",
        open: "Open",
        directory: "Directory",
        no_media_slideshow: "No images or videos in this folder",
        no_media_slideshow_desc: "Add image files (.jpg, .png, etc.) or video files (.mp4, .webm) to start the slideshow.",
        media: "Media",
        transition_speed: "Transition Speed",
        pause: "Pause",
        play: "Play",
        fullscreen: "Fullscreen",
        general_settings: "System Settings",
        manage_security: "Manage security and upload control of the Media Center",
        server_parameters: "Server Parameters",
        settings_saved_success: "Settings saved successfully!",
        enable_auth: "Enable Login Authentication",
        enable_auth_desc: "Requires password login to access any page of the Media Center.",
        login_password: "Login Password",
        login_password_desc: "Define the password that will be requested at login (default: admin).",
        allowed_extensions: "Allowed Upload Extensions",
        allowed_extensions_desc: "Comma-separated list of file extensions allowed for chunk upload.",
        language: "System Language",
        language_desc: "Choose the default language for the Media Center interface.",
        save_settings: "Save Settings",
        hidden_area: "Hidden Area",
        hidden_files: "Hidden Files",
        hidden_files_desc: "Protected files that are hidden from the normal listings of the system.",
        no_hidden_files: "No files hidden",
        no_hidden_files_desc: "You can hide files in the File Manager or libraries using the hide button.",
        back_to_dashboard: "Back to Dashboard",
        enter_password: "Enter Password",
        incorrect_password: "Incorrect password. Try again.",
        hidden_auth_title: "Protected Area Access",
        hidden_auth_desc: "This area contains hidden items. Please enter the master password to proceed:",
        login_title: "Media Center Login",
        sign_in: "Sign In",
        remote_control: "Remote Control",
        status_connected: "Connected",
        status_disconnected: "Disconnected",
        navigation: "Navigation",
        upload_media: "Upload Media",
        uploading: "Uploading...",
        upload_complete: "Upload Complete!",
        auto_preview: "Auto Preview on Desktop Screen?",
        yes: "Yes",
        no: "No",
        backup_restore: "Backup & Restore",
        backup_restore_desc: "Export or import your configurations, favorites, history, RTSP cameras, and hidden file structures.",
        export_backup: "Export Backup",
        import_backup: "Import Backup",
        select_backup_file: "Select backup file (.json)",
        remote_keyboard: "Remote Keyboard",
        type_to_screen: "Type to screen...",
        home_control: "Home Control",
        chat_ai: "Chat AI",
        tasks: "Tasks (Kanban)",
        notifications: "Notifications",
    },
    pt: {
        username: "Usuário",
        invalid_credentials: "Usuário ou senha incorretos.",
        dashboard: "Dashboard",
        explorer: "Explorer",
        files: "Arquivos",
        notes: "Notas",
        videos: "Vídeos",
        photos: "Fotos",
        music: "Músicas",
        cameras: "Câmeras",
        favorites: "Favoritos",
        settings: "Configurações",
        logout: "Sair",
        image: "Imagem",
        video_label: "Vídeo",
        actions: "Ações",
        name: "Nome",
        size: "Tamanho",
        total: "no total",
        system_status: "Status do Sistema & Dashboard",
        overview_space: "Visão geral do espaço de armazenamento, mídias recentes e banco de dados",
        recently_played: "Vídeos Assistidos Recentemente",
        no_recent_videos: "Nenhum vídeo reproduzido recentemente.",
        latest_uploads: "Últimos Arquivos Adicionados",
        no_files_shared: "Nenhum arquivo encontrado na pasta shared.",
        mobile_access: "Acesso Móvel",
        scan_qr: "Aponte a câmera do celular para abrir o Media Center",
        database_jsons: "Banco de Dados (JSONs)",
        database_desc: "Os dados de configuração das câmeras de segurança e do histórico de favoritos são armazenados localmente em arquivos de texto no formato JSON.",
        cameras_size: "Câmeras (cameras.json)",
        favorites_size: "Favoritos (favorites.json)",
        total_db_size: "Tamanho Total BD:",
        shared_folder_space: "Espaço da Pasta Shared",
        shared_folder_desc: "Todos os arquivos de mídia carregados ou copiados são indexados e ficam disponíveis no diretório público de arquivos compartilhados do servidor.",
        total_files: "Total de Arquivos",
        space_used: "Espaço Utilizado",
        server_path: "Caminho no Servidor:",
        disk_distribution: "Distribuição do Uso de Disco",
        empty_folder: "Pasta vazia",
        other: "Outro",
        others: "Outros",
        search_placeholder: "Pesquisar arquivos...",
        search_results: "Resultados da busca global por:",
        clear_search: "Limpar Busca",
        select_files_upload: "Selecione arquivos para upload",
        click_select_files: "Clique para selecionar arquivos",
        media_upload_root: "Mídia enviada ficará disponível na raiz",
        any_media_supported: "Qualquer arquivo de mídia é suportado",
        selected_files: "Selecionados",
        upload_files: "Upload de Arquivos",
        cancel: "Cancelar",
        send: "Enviar",
        create_folder: "Criar Nova Pasta",
        folder_name: "Nome da Pasta",
        hidden_folder_opt: "Deixar esta pasta oculta (requer senha para ver)",
        create: "Criar",
        list_view: "Lista",
        grid_view: "Grade",
        slideshow_view: "Slideshow",
        no_files_found: "Nenhum arquivo encontrado",
        no_files_found_desc: "Nenhum arquivo encontrado neste diretório.",
        no_favorites_saved: "Nenhum favorito salvo",
        no_favorites_desc: "Favorite arquivos na Home clicando na estrela para que eles apareçam aqui.",
        explore_files: "Explorar Arquivos",
        download: "Baixar",
        hide: "Ocultar",
        show: "Mostrar",
        delete: "Excluir",
        open: "Abrir",
        directory: "Diretório",
        no_media_slideshow: "Nenhuma imagem ou vídeo nesta pasta",
        no_media_slideshow_desc: "Adicione arquivos de imagem (.jpg, .png, etc.) ou vídeo (.mp4, .webm) para iniciar o slideshow.",
        media: "Mídia",
        transition_speed: "Velocidade de Transição",
        pause: "Pausar",
        play: "Iniciar",
        fullscreen: "Tela Cheia",
        general_settings: "Configurações do Sistema",
        manage_security: "Gerencie a segurança e o controle de uploads do Media Center",
        server_parameters: "Parâmetros do Servidor",
        settings_saved_success: "Configurações salvas com sucesso!",
        enable_auth: "Ativar Autenticação de Login",
        enable_auth_desc: "Exige login com senha para acessar qualquer página do Media Center.",
        login_password: "Senha de Login",
        login_password_desc: "Defina a senha que será solicitada no login (padrão: admin).",
        allowed_extensions: "Extensões Permitidas para Upload",
        allowed_extensions_desc: "Lista de extensões separadas por vírgula permitidas para upload em partes.",
        language: "Idioma do Sistema",
        language_desc: "Escolha o idioma padrão para a interface do Media Center.",
        save_settings: "Salvar Configurações",
        hidden_area: "Área Oculta",
        hidden_files: "Arquivos Ocultos",
        hidden_files_desc: "Arquivos protegidos que estão ocultos nas listagens comuns do sistema.",
        no_hidden_files: "Nenhum arquivo ocultado",
        no_hidden_files_desc: "Você pode ocultar arquivos no File Manager ou nas bibliotecas usando o botão de ocultar.",
        back_to_dashboard: "Voltar ao Dashboard",
        enter_password: "Senha de Acesso",
        incorrect_password: "Senha incorreta. Tente novamente.",
        hidden_auth_title: "Acesso à Área Protegida",
        hidden_auth_desc: "Esta área contém itens ocultos. Por favor, digite a senha master para prosseguir:",
        login_title: "Login do Media Center",
        sign_in: "Entrar",
        remote_control: "Controle Remoto",
        status_connected: "Conectado",
        status_disconnected: "Desconectado",
        navigation: "Navegação",
        upload_media: "Upload de Mídia",
        uploading: "Enviando...",
        upload_complete: "Upload Concluído!",
        auto_preview: "Deseja auto-visualizar na tela do Media Center?",
        yes: "Sim",
        no: "Não",
        backup_restore: "Backup e Restauração",
        backup_restore_desc: "Exporte ou importe suas configurações, favoritos, histórico, câmeras RTSP e estruturas de arquivos ocultos.",
        export_backup: "Exportar Backup",
        import_backup: "Importar Backup",
        select_backup_file: "Selecione o arquivo de backup (.json)",
        remote_keyboard: "Teclado Remoto",
        type_to_screen: "Digite para a tela...",
        home_control: "Controle Residencial",
        chat_ai: "Chat AI",
        tasks: "Tarefas (Kanban)",
        notifications: "Notificações",
    },
    es: {
        username: "Usuario",
        invalid_credentials: "Usuario o contraseña incorrectos.",
        dashboard: "Dashboard",
        explorer: "Explorador",
        files: "Archivos",
        notes: "Notas",
        videos: "Videos",
        photos: "Fotos",
        music: "Música",
        cameras: "Cámaras",
        favorites: "Favoritos",
        settings: "Configuración",
        logout: "Salir",
        image: "Imagen",
        video_label: "Vídeo",
        actions: "Acciones",
        name: "Nombre",
        size: "Tamaño",
        total: "en total",
        system_status: "Estado del Sistema & Dashboard",
        overview_space: "Descripción general del espacio de almacenamiento, medios recientes y base de datos",
        recently_played: "Videos Reproducidos Recientemente",
        no_recent_videos: "Ningún video reproducido recientemente.",
        latest_uploads: "Últimos Archivos Añadidos",
        no_files_shared: "No se encontraron archivos en la carpeta compartida.",
        mobile_access: "Acceso Móvil",
        scan_qr: "Apunte la cámara de su móvil para abrir el Media Center",
        database_jsons: "Base de Datos (JSONs)",
        database_desc: "Los datos de configuración de las cámaras de seguridad y del historial de favoritos se almacenan localmente en archivos de texto en formato JSON.",
        cameras_size: "Cámaras (cameras.json)",
        favorites_size: "Favoritos (favorites.json)",
        total_db_size: "Tamaño Total BD:",
        shared_folder_space: "Espacio de la Carpeta Compartida",
        shared_folder_desc: "Todos los archivos de medios cargados o copiados están indexados y disponibles en el directorio público de archivos compartidos del servidor.",
        total_files: "Total de Archivos",
        space_used: "Espacio Utilizado",
        server_path: "Ruta en el Servidor:",
        disk_distribution: "Distribución del Uso de Disco",
        empty_folder: "Carpeta vacía",
        other: "Otro",
        others: "Otros",
        search_placeholder: "Buscar archivos...",
        search_results: "Resultados de búsqueda global para:",
        clear_search: "Limpiar Búsqueda",
        select_files_upload: "Seleccione archivos para subir",
        click_select_files: "Haga clic para seleccionar archivos",
        media_upload_root: "Los medios subidos estarán disponibles en la raíz",
        any_media_supported: "Cuerda de medios admitida",
        selected_files: "Seleccionados",
        upload_files: "Subir Archivos",
        cancel: "Cancelar",
        send: "Enviar",
        create_folder: "Crear Nueva Carpeta",
        folder_name: "Nombre de la Carpeta",
        hidden_folder_opt: "Mantener esta carpeta oculta (requiere contraseña para ver)",
        create: "Crear",
        list_view: "Lista",
        grid_view: "Cuadrícula",
        slideshow_view: "Slideshow",
        no_files_found: "No se encontraron archivos",
        no_files_found_desc: "No se encontraron archivos en este directorio.",
        no_favorites_saved: "Ningún favorito guardado",
        no_favorites_desc: "Marque archivos como favoritos en la Página de Inicio haciendo clic en la estrella para que aparezcan aquí.",
        explore_files: "Explorar Archivos",
        download: "Descargar",
        hide: "Ocultar",
        show: "Mostrar",
        delete: "Eliminar",
        open: "Abrir",
        directory: "Directorio",
        no_media_slideshow: "No hay imágenes ni videos en esta carpeta",
        no_media_slideshow_desc: "Añada archivos de imagen (.jpg, .png, etc.) o video (.mp4, .webm) para iniciar el slideshow.",
        media: "Medios",
        transition_speed: "Velocidad de Transición",
        pause: "Pausar",
        play: "Iniciar",
        fullscreen: "Pantalla Completa",
        general_settings: "Configuración del Sistema",
        manage_security: "Gestione la seguridad y el control de subidas del Media Center",
        server_parameters: "Parámetros del Servidor",
        settings_saved_success: "¡Configuración guardada con éxito!",
        enable_auth: "Activar Autenticación de Inicio de Sesión",
        enable_auth_desc: "Requiere contraseña para acceder a cualquier página del Media Center.",
        login_password: "Contraseña de Inicio de Sesión",
        login_password_desc: "Defina la contraseña que se solicitará al iniciar sesión (por defecto: admin).",
        allowed_extensions: "Extensiones Permitidas para Subir",
        allowed_extensions_desc: "Lista de extensiones separadas por comas permitidas para la subida en partes.",
        language: "Idioma del Sistema",
        language_desc: "Elija el idioma predeterminado para la interfaz del Media Center.",
        save_settings: "Guardar Configuración",
        hidden_area: "Área Oculta",
        hidden_files: "Archivos Ocultos",
        hidden_files_desc: "Archivos protegidos que están ocultos de las listas comunes del sistema.",
        no_hidden_files: "Ningún archivo oculto",
        no_hidden_files_desc: "Puede ocultar archivos en el Administrador de Archivos o bibliotecas usando el botón de ocultar.",
        back_to_dashboard: "Volver al Dashboard",
        enter_password: "Contraseña de Acceso",
        incorrect_password: "Contraseña incorrecta. Inténtelo de nuevo.",
        hidden_auth_title: "Acceso al Área Protegida",
        hidden_auth_desc: "Esta área contiene elementos ocultos. Por favor, introduzca la contraseña maestra para continuar:",
        login_title: "Inicio de Sesión de Media Center",
        sign_in: "Entrar",
        remote_control: "Control Remoto",
        status_connected: "Conectado",
        status_disconnected: "Desconectado",
        navigation: "Navegación",
        upload_media: "Subir Medio",
        uploading: "Subiendo...",
        upload_complete: "¡Subida Completada!",
        auto_preview: "¿Desea auto-visualizar en la pantalla del Media Center?",
        yes: "Sí",
        no: "No",
        backup_restore: "Copia de Seguridad y Restauración",
        backup_restore_desc: "Exporte o importe sus configuraciones, favoritos, historial, cámaras RTSP y estructuras de archivos ocultos.",
        export_backup: "Exportar Copia de Seguridad",
        import_backup: "Importar Copia de Seguridad",
        select_backup_file: "Seleccione el archivo de copia de seguridad (.json)",
        remote_keyboard: "Teclado Remoto",
        type_to_screen: "Escriba a la pantalla...",
        home_control: "Control del Hogar",
        chat_ai: "Chat AI",
        tasks: "Tareas (Kanban)",
        notifications: "Notificaciones",
    }
};

// Middleware para injeção de internacionalização (i18n)
app.use((req, res, next) => {
    const lang = config.language || 'en';
    const dict = translations[lang] || translations['en'];
    res.locals.t = (key) => dict[key] || translations['en'][key] || key;
    res.locals.currentLang = lang;
    res.locals.config = config;
    res.locals.notifications = notifications;
    
    // Se configurado endereço personalizado, usamos ele, senão calcula localIp
    const baseAddr = config.appAddress || `http://${getLocalIp()}:${PORT}`;
    res.locals.remoteUrl = `${baseAddr}/remote`;
    res.locals.localIp = getLocalIp();
    res.locals.port = PORT;
    next();
});

// Middleware para arquivos estáticos com suporte a MIME-types para HLS
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: function(res, filePath) {
        if (filePath.endsWith('.m3u8')) {
            res.setHeader('Content-Type', 'application/x-mpegURL');
        } else if (filePath.endsWith('.ts')) {
            res.setHeader('Content-Type', 'video/MP2T');
        }
    }
}));

// Middleware de Autenticação Global
app.use(authMiddleware);

app.use('/shared', express.static(path.join(__dirname, SHARED_DIR)));
app.use(express.json());

// Função auxiliar para verificar se um caminho (ou qualquer diretório pai) está oculto
function isPathHidden(relativeItemPath, excludeHidden = true, parentPath = '') {
    if (!excludeHidden) return false;
    if (!relativeItemPath) return false;
    
    const parts = relativeItemPath.split(/[/\\]/);
    const parentParts = parentPath ? parentPath.split(/[/\\]/) : [];
    
    let currentPath = '';
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!part) continue;
        // Arquivos e diretórios iniciados com ponto são considerados ocultos (ex: .DS_Store, .git)
        if (part.startsWith('.')) return true;
        
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        
        // Se este componente do caminho faz parte do parentPath, não o consideramos como motivo para ocultar,
        // pois o usuário já está navegando explicitamente dentro dele.
        if (i < parentParts.length && parentParts[i] === part) {
            continue;
        }
        
        if (hiddenFiles.includes(currentPath)) {
            return true;
        }
    }
    return false;
}

// Função recursiva para listar todos os arquivos no diretório compartilhado
function getRecursiveFiles(dir, relativeDir = '', excludeHidden = true) {
    let results = [];
    const absolutePath = path.join(dir, relativeDir);
    if (!fs.existsSync(absolutePath)) return [];
    
    const list = fs.readdirSync(absolutePath, { withFileTypes: true });
    list.forEach(item => {
        const relativeItemPath = relativeDir ? `${relativeDir}/${item.name}` : item.name;
        if (item.isDirectory()) {
            if (item.name !== 'temp' && item.name !== 'optimized') { // Ignora pasta de upload temporário e arquivos otimizados
                if (excludeHidden && isPathHidden(relativeItemPath, excludeHidden, relativeDir)) return;
                results = results.concat(getRecursiveFiles(dir, relativeItemPath, excludeHidden));
            }
        } else {
            if (item.name.startsWith('optimized_') || item.name.endsWith('.tmp')) return; // Oculta arquivos otimizados e temporários
            if (excludeHidden && isPathHidden(relativeItemPath, excludeHidden, relativeDir)) return;
            try {
                const stats = fs.statSync(path.join(dir, relativeItemPath));
                results.push({
                    name: item.name,
                    path: relativeItemPath,
                    size: stats.size,
                    mtime: stats.mtime,
                    isFile: true
                });
            } catch (e) {
                console.error("Erro ao ler status do arquivo:", e);
            }
        }
    });
    return results;
}

// Função para listar arquivos e diretórios
function getDirContents(dirPath, excludeHidden = true) {
    const fullPath = path.join(__dirname, SHARED_DIR, dirPath);
    if (!fs.existsSync(fullPath)) return { files: [], dirs: [] };

    const contents = fs.readdirSync(fullPath, { withFileTypes: true });
    const files = contents
        .filter(item => {
            if (!item.isFile()) return false;
            if (item.name.startsWith('optimized_') || item.name.endsWith('.tmp')) return false;
            const itemPath = dirPath ? `${dirPath}/${item.name}` : item.name;
            if (excludeHidden && isPathHidden(itemPath, excludeHidden, dirPath)) return false;
            return true;
        })
        .map(item => {
            const stats = fs.statSync(path.join(fullPath, item.name));
            return { name: item.name, isFile: true, size: stats.size };
        });

    const dirs = contents
        .filter(item => {
            if (!item.isDirectory()) return false;
            if (item.name === 'temp' || item.name === 'optimized') return false;
            const itemPath = dirPath ? `${dirPath}/${item.name}` : item.name;
            if (excludeHidden && isPathHidden(itemPath, excludeHidden, dirPath)) return false;
            return true;
        })
        .map(item => ({ name: item.name, isFile: false }));

    return [...dirs, ...files];
}

// Rota principal (File Manager / Explorer)
app.get('/explorer', (req, res) => {
    const rawPath = req.query.path || '';
    const currentPath = getAuthorizedPath(req, rawPath);
    const search = req.query.search || '';
    
    // Validar se o usuário tem permissão para esta pasta específica
    if (!isPathAllowed(req, currentPath)) {
        return res.status(403).send('Forbidden: Você não tem permissão para acessar este diretório.');
    }
    
    // Filtrar favoritos visíveis
    let filteredFavorites = favorites.filter(file => !isPathHidden(file, true));
    if (req.userGroup === 'customer') {
        filteredFavorites = filteredFavorites.filter(file => isPathAllowed(req, file));
    }
    
    if (search) {
        // Busca recursiva global filtrada
        let files = getRecursiveFiles(path.join(__dirname, SHARED_DIR));
        if (req.userGroup === 'customer') {
            files = files.filter(f => isPathAllowed(req, f.path));
        }
        files = files.filter(f => f.name.toLowerCase().includes(search.toLowerCase()));
        
        // Ordena por upload (mtime desc)
        files.sort((a, b) => b.mtime - a.mtime);
        
        res.render('index', { 
            contents: files, 
            currentPath: '', 
            search,
            favorites: filteredFavorites 
        });
    } else {
        const contents = getDirContents(currentPath);
        res.render('index', { 
            contents, 
            currentPath, 
            search: '',
            favorites: filteredFavorites 
        });
    }
});

// Rota para upload de chunks
app.post('/upload-chunk', express.raw({ type: '*/*', limit: '50mb' }), async (req, res) => {
    const { chunkIndex, totalChunks, fileName } = req.query;
    const rawPath = req.query.currentPath || '';
    const currentPath = getAuthorizedPath(req, rawPath);

    // Validar se o caminho final é permitido
    const targetRelPath = path.join(currentPath, fileName || '');
    if (!isPathAllowed(req, targetRelPath)) {
        return res.status(403).json({ success: false, error: 'Acesso negado: Você não tem permissão para esta pasta.' });
    }

    // Validar extensão do arquivo
    if (fileName) {
        const ext = path.extname(fileName).toLowerCase();
        const allowedList = config.allowedExtensions
            ? config.allowedExtensions.split(',').map(x => x.trim().toLowerCase()).filter(x => x.length > 0)
            : [];
            
        if (allowedList.length > 0) {
            const match = allowedList.some(allowedExt => {
                const formattedAllowed = allowedExt.startsWith('.') ? allowedExt : `.${allowedExt}`;
                return formattedAllowed === ext;
            });
            if (!match) {
                return res.status(400).json({ 
                    success: false, 
                    error: `Extensão '${ext}' não é permitida para upload. Extensões permitidas: ${config.allowedExtensions}` 
                });
            }
        }
    }

    const tempDir = path.join(__dirname, SHARED_DIR, 'temp', fileName);
    const chunkPath = path.join(tempDir, `chunk-${chunkIndex}`);
    const finalPath = path.join(__dirname, SHARED_DIR, currentPath, fileName);

    try {
        await fs.ensureDir(tempDir);
        await fs.writeFile(chunkPath, req.body);

        if (parseInt(chunkIndex) + 1 === parseInt(totalChunks)) {
            await fs.ensureDir(path.dirname(finalPath));
            const writeStream = fs.createWriteStream(finalPath);

            for (let i = 0; i < totalChunks; i++) {
                const chunkFile = path.join(tempDir, `chunk-${i}`);
                const chunkData = await fs.readFile(chunkFile);
                writeStream.write(chunkData);
                await fs.remove(chunkFile);
            }
            writeStream.end();

            await fs.remove(tempDir);
            const webPath = '/shared/' + currentPath.replace(/\\/g, '/') + (currentPath ? '/' : '') + fileName;
            res.json({ success: true, message: 'Upload concluído!', url: webPath });
        } else {
            res.json({ success: true, message: `Chunk ${chunkIndex} recebido` });
        }
    } catch (error) {
        console.error('Erro no upload:', error);
        res.status(500).json({ success: false, error: 'Erro ao processar chunk' });
    }
});

// Rota para criar diretórios
app.post('/create-dir', express.urlencoded({ extended: true }), (req, res) => {
    const dirName = req.body.dirName;
    const rawPath = req.body.path || '';
    const currentPath = getAuthorizedPath(req, rawPath);
    
    // Validar se o caminho de destino é permitido
    const targetRelPath = path.join(currentPath, dirName || '');
    if (!isPathAllowed(req, targetRelPath)) {
        return res.status(403).send('Forbidden: Acesso negado.');
    }

    const isHidden = req.body.isHidden === 'true';
    const newDirPath = path.join(__dirname, SHARED_DIR, currentPath, dirName);
    
    fs.ensureDirSync(newDirPath);
    
    if (isHidden) {
        const relativeItemPath = currentPath ? `${currentPath}/${dirName}` : dirName;
        if (!hiddenFiles.includes(relativeItemPath)) {
            hiddenFiles.push(relativeItemPath);
            try {
                fs.writeJsonSync(HIDDEN_FILES_FILE, hiddenFiles, { spaces: 2 });
            } catch (e) {
                console.error("Erro ao salvar hidden_files.json ao criar diretório:", e);
            }
        }
    }
    
    res.redirect(`/explorer?path=${currentPath}`);
});

// Rota para remover arquivos
app.post('/delete-file', express.urlencoded({ extended: true }), (req, res) => {
    const fileName = req.body.file;
    const rawPath = req.body.path || '';
    const currentPath = getAuthorizedPath(req, rawPath);
    
    // Validar se o caminho do arquivo é permitido
    const targetRelPath = path.join(currentPath, fileName || '');
    if (!isPathAllowed(req, targetRelPath)) {
        return res.status(403).send('Forbidden: Acesso negado.');
    }

    const filePath = path.join(__dirname, SHARED_DIR, currentPath, fileName);
    if (fs.existsSync(filePath)) {
        fs.removeSync(filePath);
    }
    res.redirect(`/explorer?path=${currentPath}`);
});

// Rota para remover diretórios
app.post('/delete-dir', express.urlencoded({ extended: true }), (req, res) => {
    const dirName = req.body.dir;
    const rawPath = req.body.path || '';
    const currentPath = getAuthorizedPath(req, rawPath);
    
    // Validar se o caminho do diretório é permitido
    const targetRelPath = path.join(currentPath, dirName || '');
    if (!isPathAllowed(req, targetRelPath)) {
        return res.status(403).send('Forbidden: Acesso negado.');
    }

    const dirPath = path.join(__dirname, SHARED_DIR, currentPath, dirName);
    if (fs.existsSync(dirPath)) {
        fs.removeSync(dirPath);
    }
    res.redirect(`/explorer?path=${currentPath}`);
});

app.get('/prompt', (req, res) => {
    res.render('prompt', { history: promptHistory });
});

app.post('/prompt', express.urlencoded({ extended: true }), (req, res) => {
    const { command } = req.body;
    let response = "";
    
    // Parse raw cookies
    const cookieHeader = req.headers.cookie || '';
    const cookies = cookieHeader ? Object.fromEntries(cookieHeader.split('; ').map(c => {
        const parts = c.split('=');
        return [parts[0], decodeURIComponent(parts[1] || '')];
    })) : {};
    const state = cookies.prompt_state || '';

    if (command) {
        const cmd = command.trim();
        const cmdLower = cmd.toLowerCase();

        if (state === 'expect_current_password') {
            if (cmd === hiddenPassword) {
                res.cookie('prompt_state', 'expect_new_password', { maxAge: 300000, httpOnly: true, path: '/' });
                response = "Senha atual correta. Por favor, digite a nova senha:";
            } else {
                res.clearCookie('prompt_state', { path: '/' });
                response = "Senha atual incorreta. Operação cancelada.";
            }
            promptHistory.push({ command: '****', response });
        } else if (state === 'expect_new_password') {
            if (cmd.length > 0) {
                hiddenPassword = cmd;
                config.loginPassword = cmd;
                try {
                    fs.writeJsonSync(PASSWORD_FILE, { password: hiddenPassword }, { spaces: 2 });
                    fs.writeJsonSync(CONFIG_FILE, config, { spaces: 2 });
                    response = "Senha alterada com sucesso!";
                } catch (e) {
                    console.error("Erro ao salvar nova senha:", e);
                    response = "Erro interno ao salvar a nova senha.";
                }
            } else {
                response = "Senha inválida. Operação cancelada.";
            }
            res.clearCookie('prompt_state', { path: '/' });
            promptHistory.push({ command: '****', response });
        } else {
            // Comandos normais
            if (cmdLower === 'ajuda' || cmdLower === 'help') {
                response = "Comandos disponíveis: 'listar', 'status', 'limpar', 'marca', 'change password'.";
            } else if (cmdLower === 'change password') {
                res.cookie('prompt_state', 'expect_current_password', { maxAge: 300000, httpOnly: true, path: '/' });
                response = "Por favor, digite a senha atual:";
            } else if (cmdLower === 'listar' || cmdLower === 'ls') {
                response = "Diretório raiz do Black Bird contém: public, views, server.js, package.json.";
            } else if (cmdLower === 'status') {
                response = `Sistema ativo na porta ${PORT}. Câmeras: ${cameras.length} cadastradas. Favoritos: ${favorites.length} itens.`;
            } else if (cmdLower === 'marca' || cmdLower === 'brand') {
                response = "Black Bird Media Center - Premium Home System";
            } else if (cmdLower === 'limpar' || cmdLower === 'clear') {
                promptHistory = [];
                return res.redirect('/prompt');
            } else {
                response = `Comando '${command}' recebido. Sem ações programadas para este comando.`;
            }
            promptHistory.push({ command, response });
        }
    }
    res.redirect('/prompt');
});

app.get('/cameras', (req, res) => {
    const isStreaming = req.query.streaming === 'true';
    res.render('cameras', { cameras, currentPath: '', isStreaming });
});

app.post('/rtsp-cams/add', express.urlencoded({ extended: true }), (req, res) => {
    const { name, url } = req.body;
    if (name && url) {
        cameras.push({ name, url });
        try {
            fs.writeJsonSync(CAMERAS_FILE, cameras, { spaces: 2 });
        } catch (e) {
            console.error("Erro ao salvar cameras.json:", e);
        }
    }
    res.redirect('/cameras');
});

app.post('/rtsp-cams/delete/:index', (req, res) => {
    const index = parseInt(req.params.index);
    if (!isNaN(index) && index >= 0 && index < cameras.length) {
        cameras.splice(index, 1);
        try {
            fs.writeJsonSync(CAMERAS_FILE, cameras, { spaces: 2 });
        } catch (e) {
            console.error("Erro ao salvar cameras.json:", e);
        }
    }
    res.redirect('/cameras');
});

app.get('/rtsp-cams/streaming', (req, res) => {
    res.redirect('/cameras?streaming=true');
});

app.get('/favorites', (req, res) => {
    const filteredFavorites = favorites.filter(file => !isPathHidden(file, true));
    res.render('favorites', { favorites: filteredFavorites });
});

app.post('/favorites/toggle', express.urlencoded({ extended: true }), (req, res) => {
    const file = req.body.file;
    if (file) {
        const index = favorites.indexOf(file);
        if (index > -1) {
            favorites.splice(index, 1);
        } else {
            favorites.push(file);
        }
        try {
            fs.writeJsonSync(FAVORITES_FILE, favorites, { spaces: 2 });
        } catch (e) {
            console.error("Erro ao salvar favorites.json:", e);
        }
    }
    const backURL = req.header('Referer') || '/';
    res.redirect(backURL);
});

app.post('/hide/toggle', express.urlencoded({ extended: true }), (req, res) => {
    const file = req.body.file;
    if (file) {
        const index = hiddenFiles.indexOf(file);
        if (index > -1) {
            hiddenFiles.splice(index, 1);
        } else {
            hiddenFiles.push(file);
        }
        try {
            fs.writeJsonSync(HIDDEN_FILES_FILE, hiddenFiles, { spaces: 2 });
        } catch (e) {
            console.error("Erro ao salvar hidden_files.json:", e);
        }
    }
    const backURL = req.header('Referer') || '/explorer';
    if (backURL.includes('/hidden-area')) {
        res.cookie('hidden_authenticated', 'true', { maxAge: 10000, httpOnly: true, path: '/' });
    }
    res.redirect(backURL);
});

app.get('/play', (req, res) => {
    const video = req.query.video || '';
    const fullPath = path.join(__dirname, SHARED_DIR, video);
    if (fs.existsSync(fullPath)) {
        // Adicionar ao histórico de visualizações
        try {
            historyList = historyList.filter(item => item.file !== video);
            historyList.unshift({ file: video, playedAt: Date.now() });
            if (historyList.length > 12) {
                historyList = historyList.slice(0, 12);
            }
            fs.writeJsonSync(HISTORY_FILE, historyList, { spaces: 2 });
        } catch (e) {
            console.error("Erro ao salvar histórico de reprodução:", e);
        }

        // Buscar legendas associadas na mesma pasta do vídeo
        const videoDir = path.dirname(fullPath);
        const videoBaseWithoutExt = path.basename(fullPath, path.extname(fullPath));
        let subtitles = [];
        try {
            if (fs.existsSync(videoDir)) {
                const dirFiles = fs.readdirSync(videoDir);
                subtitles = dirFiles
                    .filter(file => {
                        const ext = path.extname(file).toLowerCase();
                        const fileBaseWithoutExt = path.basename(file, ext);
                        
                        // Permite extensões .srt e .vtt
                        const isSubtitleExt = ext === '.srt' || ext === '.vtt';
                        // Nome deve iniciar com o mesmo nome do vídeo ou ser igual
                        const isMatchingName = fileBaseWithoutExt.toLowerCase() === videoBaseWithoutExt.toLowerCase() ||
                                               fileBaseWithoutExt.toLowerCase().startsWith(videoBaseWithoutExt.toLowerCase() + '.');
                        
                        return isSubtitleExt && (isMatchingName || fileBaseWithoutExt.toLowerCase().startsWith(videoBaseWithoutExt.toLowerCase()));
                    })
                    .map(file => {
                        const relativeSubPath = path.join(path.dirname(video), file);
                        return {
                            name: file,
                            path: relativeSubPath,
                            ext: path.extname(file).toLowerCase()
                        };
                    });
            }
        } catch (e) {
            console.error("Erro ao varrer legendas do filme:", e);
        }

        const filteredFavorites = favorites.filter(file => !isPathHidden(file, true));
        ffmpeg.ffprobe(fullPath, (err, metadata) => {
            let duration = 0;
            if (!err && metadata && metadata.format && metadata.format.duration) {
                duration = parseFloat(metadata.format.duration);
            }
            res.render('play', { video, favorites: filteredFavorites, duration: duration, subtitles: subtitles });
        });
    } else {
        const filteredFavorites = favorites.filter(file => !isPathHidden(file, true));
        res.render('play', { video, favorites: filteredFavorites, duration: 0, subtitles: [] });
    }
});

// Rota para carregar e converter legendas (.srt para .vtt se necessário)
app.get('/subtitles/vtt', (req, res) => {
    const subtitlePath = req.query.file || '';
    const fullPath = path.join(__dirname, SHARED_DIR, subtitlePath);
    
    if (fs.existsSync(fullPath)) {
        try {
            const ext = path.extname(fullPath).toLowerCase();
            let content = fs.readFileSync(fullPath, 'utf-8');
            
            if (ext === '.srt') {
                // Converter de SRT para WebVTT
                content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
                content = content.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
                content = "WEBVTT\n\n" + content;
            }
            
            res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
            return res.send(content);
        } catch (e) {
            console.error("Erro ao converter arquivo de legenda:", e);
            return res.status(500).send("Erro ao processar legenda.");
        }
    }
    res.status(404).send("Arquivo de legenda não encontrado.");
});

// Gerenciamento de processos de transcoding de MKV para HLS (para TVs antigas)
const activeTranscodes = {};
// Gerenciamento de processos de otimização completa (Pre-transcoding de MKV para MP4)
const activeOptimizations = {};
// Gerenciamento de processos de conversão permanente de MKV para MP4
const activeConversions = {};

function getVideoHash(filePath) {
    return crypto.createHash('md5').update(filePath).digest('hex');
}

function cleanupTranscode(hash) {
    const transcode = activeTranscodes[hash];
    if (transcode) {
        console.log(`Finalizando processo de transcoding para o hash: ${hash}`);
        try {
            transcode.process.kill('SIGKILL');
        } catch (e) {
            // ignorar
        }
        setTimeout(() => {
            try {
                fs.removeSync(transcode.outputDir);
                console.log(`Diretório de transcodificação limpo: ${transcode.outputDir}`);
            } catch (e) {
                console.error(`Erro ao limpar diretório ${transcode.outputDir}:`, e);
            }
        }, 1000);
        delete activeTranscodes[hash];
    }
}

function cleanupOptimization(hash) {
    const optimization = activeOptimizations[hash];
    if (optimization) {
        console.log(`Finalizando processo de otimização para o hash: ${hash}`);
        try {
            optimization.process.kill('SIGKILL');
        } catch (e) {
            // ignorar
        }
        const tempPath = path.join(__dirname, SHARED_DIR, 'optimized_' + hash + '.tmp');
        setTimeout(() => {
            try {
                if (fs.existsSync(tempPath)) {
                    fs.removeSync(tempPath);
                    console.log(`Arquivo temporário de otimização removido: ${tempPath}`);
                }
            } catch (e) {
                console.error(`Erro ao remover arquivo temporário ${tempPath}:`, e);
            }
        }, 1000);
        delete activeOptimizations[hash];
    }
}

// Intervalo para limpar sessões inativas (expira após 30 segundos sem heartbeat/poll)
setInterval(() => {
    const now = Date.now();
    // Limpar HLS
    Object.keys(activeTranscodes).forEach(hash => {
        if (now - activeTranscodes[hash].lastHeartbeat > 30000) {
            console.log(`Limpando transcodificação inativa por inatividade: ${hash}`);
            cleanupTranscode(hash);
        }
    });
    // Limpar otimização MP4 (inativo se sem poll por 30s)
    Object.keys(activeOptimizations).forEach(hash => {
        if (!activeOptimizations[hash].finished && (now - activeOptimizations[hash].lastPoll > 30000)) {
            console.log(`Limpando otimização MP4 inativa por inatividade: ${hash}`);
            cleanupOptimization(hash);
        }
    });
}, 10000);

// Limpeza de todos os processos no encerramento do processo Node
process.on('SIGTERM', () => {
    Object.keys(activeTranscodes).forEach(hash => {
        cleanupTranscode(hash);
    });
    Object.keys(activeOptimizations).forEach(hash => {
        cleanupOptimization(hash);
    });
    Object.keys(activeConversions).forEach(hash => {
        try { activeConversions[hash].process.kill('SIGKILL'); } catch (e) {}
        try {
            if (activeConversions[hash].tempOutputPath && fs.existsSync(activeConversions[hash].tempOutputPath)) {
                fs.removeSync(activeConversions[hash].tempOutputPath);
            }
        } catch (e) {}
    });
    process.exit(0);
});
process.on('SIGINT', () => {
    Object.keys(activeTranscodes).forEach(hash => {
        cleanupTranscode(hash);
    });
    Object.keys(activeOptimizations).forEach(hash => {
        cleanupOptimization(hash);
    });
    Object.keys(activeConversions).forEach(hash => {
        try { activeConversions[hash].process.kill('SIGKILL'); } catch (e) {}
        try {
            if (activeConversions[hash].tempOutputPath && fs.existsSync(activeConversions[hash].tempOutputPath)) {
                fs.removeSync(activeConversions[hash].tempOutputPath);
            }
        } catch (e) {}
    });
    process.exit(0);
});

app.get('/stream-hls', async (req, res) => {
    const file = req.query.file;
    if (!file) {
        return res.status(400).send('Arquivo não especificado');
    }
    const fullPath = path.join(__dirname, SHARED_DIR, file);
    if (!fs.existsSync(fullPath)) {
        return res.status(404).send('Vídeo não encontrado');
    }

    const hash = getVideoHash(file);
    const outputDir = path.join(__dirname, 'public', 'hls', `transcoded_${hash}`);

    if (!activeTranscodes[hash]) {
        try {
            await fs.ensureDir(outputDir);
            await fs.emptyDir(outputDir);

            console.log(`Iniciando transcodificação HLS para ${file} no diretório: ${outputDir}`);
            
            const transcodeProcess = ffmpeg(fullPath)
                .videoCodec('libx264')
                .audioCodec('aac')
                .outputOptions([
                    '-hls_time 6',
                    '-hls_list_size 0',
                    '-hls_segment_type mpegts',
                    '-pix_fmt yuv420p',           // Garante compatibilidade de cor de 8 bits
                    '-ac 2',                       // Força downmix estéreo para melhor suporte em TVs
                    '-preset ultrafast',
                    '-tune zerolatency',
                    '-crf 28',
                    '-g 30'
                ])
                .output(path.join(outputDir, 'playlist.m3u8'))
                .on('error', (err) => {
                    console.error(`Erro no transcoding HLS para o arquivo ${file}:`, err.message);
                    cleanupTranscode(hash);
                })
                .on('end', () => {
                    console.log(`Transcoding HLS finalizado com sucesso para: ${file}`);
                    if (activeTranscodes[hash]) {
                        activeTranscodes[hash].finished = true;
                    }
                });

            activeTranscodes[hash] = {
                process: transcodeProcess,
                outputDir: outputDir,
                lastHeartbeat: Date.now(),
                finished: false
            };

            transcodeProcess.run();
        } catch (err) {
            console.error(`Falha ao configurar diretórios de transcodificação:`, err);
            return res.status(500).json({ success: false, error: 'Erro ao configurar arquivos temporários' });
        }
    } else {
        activeTranscodes[hash].lastHeartbeat = Date.now();
    }

    // Aguardar até o arquivo playlist.m3u8 existir e ter pelo menos 3 fragmentos .ts (ou finalizar)
    let attempts = 0;
    const playlistPath = path.join(outputDir, 'playlist.m3u8');
    
    const checkPlaylist = () => {
        attempts++;
        if (fs.existsSync(playlistPath)) {
            try {
                const content = fs.readFileSync(playlistPath, 'utf8');
                const tsCount = (content.match(/\.ts/g) || []).length;
                const isFinished = content.indexOf('#EXT-X-ENDLIST') !== -1;
                
                // Exigir pelo menos 3 segmentos .ts para dar tempo do player bufferizar estável,
                // ou liberar imediatamente caso o vídeo inteiro já tenha finalizado.
                if (tsCount >= 3 || isFinished) {
                    return res.json({
                        success: true,
                        url: `/hls/transcoded_${hash}/playlist.m3u8`,
                        hash: hash
                    });
                }
            } catch (e) {
                // ignorar pequenos erros de concorrência de leitura
            }
        }
        if (attempts >= 60) { // 30 segundos no máximo
            return res.status(500).json({ success: false, error: 'Tempo limite para iniciar o streaming HLS esgotado.' });
        }
        setTimeout(checkPlaylist, 500);
    };

    checkPlaylist();
});

app.post('/stream-hls/heartbeat', (req, res) => {
    const { hash } = req.body;
    if (hash && activeTranscodes[hash]) {
        activeTranscodes[hash].lastHeartbeat = Date.now();
        return res.json({ success: true });
    }
    res.status(404).json({ success: false, error: 'Sessão de transcodificação não encontrada ou expirada.' });
});

app.get('/stream-camera', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    const url = req.query.url;
    if (!url) {
        return res.status(400).send('URL não especificada');
    }

    const hash = crypto.createHash('md5').update(url).digest('hex');
    const outputDir = path.join(__dirname, 'public', 'hls', `camera_${hash}`);

    if (!activeTranscodes[hash]) {
        try {
            await fs.ensureDir(outputDir);
            await fs.emptyDir(outputDir);

            console.log(`Iniciando transcodificação RTSP HLS para ${url} no diretório: ${outputDir}`);
            
            const transcodeProcess = ffmpeg(url)
                .inputOptions([
                    '-rtsp_transport tcp',
                    '-analyzeduration 1000000',
                    '-probesize 1000000'
                ])
                .videoCodec('libx264')
                .noAudio()
                .outputOptions([
                    '-vf scale=-2:480',
                    '-hls_time 2',
                    '-hls_list_size 3',
                    '-hls_flags delete_segments',
                    '-pix_fmt yuv420p',
                    '-profile:v baseline',
                    '-level 3.0',
                    '-preset ultrafast',
                    '-tune zerolatency',
                    '-threads 0',
                    '-g 30'
                ])
                .output(path.join(outputDir, 'playlist.m3u8'))
            const logStream = fs.createWriteStream(path.join(outputDir, 'ffmpeg.log'));
            transcodeProcess.on('stderr', (line) => {
                logStream.write(line + '\n');
            });

            transcodeProcess
                .on('error', (err) => {
                    console.error(`Erro no transcoding RTSP para ${url}:`, err.message);
                    logStream.end();
                    cleanupTranscode(hash);
                })
                .on('end', () => {
                    console.log(`Transcoding RTSP finalizado com sucesso para: ${url}`);
                    logStream.end();
                    if (activeTranscodes[hash]) {
                        activeTranscodes[hash].finished = true;
                    }
                });

            activeTranscodes[hash] = {
                process: transcodeProcess,
                outputDir: outputDir,
                lastHeartbeat: Date.now(),
                finished: false
            };

            transcodeProcess.run();
        } catch (err) {
            console.error(`Falha ao configurar diretórios de transcodificação de câmera:`, err);
            return res.status(500).json({ success: false, error: 'Erro ao configurar arquivos temporários' });
        }
    } else {
        activeTranscodes[hash].lastHeartbeat = Date.now();
    }

    // Aguardar até o arquivo playlist.m3u8 existir e ter pelo menos 1 fragmento .ts
    let attempts = 0;
    const playlistPath = path.join(outputDir, 'playlist.m3u8');
    
    const checkPlaylist = () => {
        attempts++;
        if (fs.existsSync(playlistPath)) {
            try {
                const content = fs.readFileSync(playlistPath, 'utf8');
                const tsCount = (content.match(/\.ts/g) || []).length;
                if (tsCount >= 1) {
                    console.log(`[STREAM SUCCESS]: Câmera HLS pronta para url: ${url} após ${attempts * 500}ms`);
                    return res.json({
                        success: true,
                        url: `/hls/camera_${hash}/playlist.m3u8`,
                        hash: hash
                    });
                }
            } catch (e) {
                // ignorar
            }
        }
        if (attempts >= 40) { // 20 segundos
            console.error(`[STREAM TIMEOUT]: Falha ao iniciar câmera HLS para url: ${url} após 20 segundos`);
            return res.status(500).json({ success: false, error: 'Tempo limite para iniciar o streaming de câmera esgotado.' });
        }
        setTimeout(checkPlaylist, 500);
    };

    checkPlaylist();
});

app.post('/stream-camera/heartbeat', (req, res) => {
    const { hash } = req.body;
    if (hash && activeTranscodes[hash]) {
        activeTranscodes[hash].lastHeartbeat = Date.now();
        return res.json({ success: true });
    }
    res.status(404).json({ success: false, error: 'Sessão de transcodificação da câmera não encontrada ou expirada.' });
});

app.post('/log-client', (req, res) => {
    console.log("[CLIENT LOG]:", JSON.stringify(req.body, null, 2));
    res.sendStatus(200);
});

app.get('/optimize-video', async (req, res) => {
    const file = req.query.file;
    if (!file) {
        return res.status(400).json({ success: false, error: 'Arquivo não especificado' });
    }
    const fullPath = path.join(__dirname, SHARED_DIR, file);
    if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ success: false, error: 'Vídeo não encontrado' });
    }

    const part = parseInt(req.query.part) || 0;
    const chunkDuration = 600; // 10 minutos (600 segundos)

    // O hash agora leva em conta a parte/segmento solicitado para que tenhamos arquivos de saída diferentes
    const hash = getVideoHash(file + '_part_' + part);
    const finalFilename = 'optimized_' + hash + '.mp4';
    const tempFilename = 'optimized_' + hash + '.tmp';
    const finalPath = path.join(__dirname, SHARED_DIR, finalFilename);
    const tempPath = path.join(__dirname, SHARED_DIR, tempFilename);

    // Se o arquivo final já existe, está pronto
    if (fs.existsSync(finalPath) && !activeOptimizations[hash]) {
        return res.json({
            success: true,
            finished: true,
            url: `/shared/${finalFilename}`,
            hash: hash
        });
    }

    // Se já estiver sendo otimizado
    if (activeOptimizations[hash]) {
        activeOptimizations[hash].lastPoll = Date.now();
        return res.json({
            success: true,
            finished: activeOptimizations[hash].finished,
            percent: Math.round(activeOptimizations[hash].percent),
            url: `/shared/${finalFilename}`,
            hash: hash
        });
    }

    // Iniciar uma nova otimização. Primeiro, obter a duração usando ffprobe
    ffmpeg.ffprobe(fullPath, async (err, metadata) => {
        let duration = 0;
        if (!err && metadata && metadata.format && metadata.format.duration) {
            duration = parseFloat(metadata.format.duration);
        }
        console.log(`Vídeo ${file} - Duração total por ffprobe: ${duration}s. Fatiando parte ${part} (${part * chunkDuration}s - ${(part + 1) * chunkDuration}s)`);

        // A duração efetiva deste chunk é no máximo chunkDuration
        // Se for o último chunk, pode ser menor
        let targetDuration = chunkDuration;
        if (duration > 0) {
            const remaining = duration - (part * chunkDuration);
            if (remaining > 0 && remaining < chunkDuration) {
                targetDuration = remaining;
            }
        }

        try {
            // Garantir que não há arquivos parciais antigos
            if (fs.existsSync(tempPath)) {
                await fs.remove(tempPath);
            }

            console.log(`Iniciando otimização do chunk ${part} para ${file}. Destino temporário: ${tempPath}`);

            const optimizationProcess = ffmpeg(fullPath)
                .inputOptions([
                    `-ss ${part * chunkDuration}` // Posiciona a leitura rápida no início do segmento
                ])
                .duration(targetDuration)         // Define o tamanho exato da fatia
                .format('mp4')
                .videoCodec('libx264')
                .audioCodec('aac')
                .outputOptions([
                    '-pix_fmt yuv420p',           // Compatibilidade de cor de 8 bits
                    '-ac 2',                       // Downmix estéreo
                    '-movflags +faststart',        // Faststart para reprodução rápida no navegador
                    '-preset ultrafast',           // Velocidade máxima
                    '-crf 28'                      // Taxa de compressão razoável
                ])
                .output(tempPath)
                .on('progress', (progress) => {
                    if (activeOptimizations[hash]) {
                        let computedPercent = 0;
                        if (progress.percent !== undefined) {
                            computedPercent = progress.percent;
                        } else if (targetDuration > 0 && progress.timemark) {
                            // Converter timemark (hh:mm:ss.xs) para segundos
                            const parts = progress.timemark.split(':');
                            if (parts.length === 3) {
                                const hrs = parseFloat(parts[0]);
                                const mins = parseFloat(parts[1]);
                                const secs = parseFloat(parts[2]);
                                const elapsed = hrs * 3600 + mins * 60 + secs;
                                computedPercent = (elapsed / targetDuration) * 100;
                            }
                        }
                        activeOptimizations[hash].percent = Math.min(99, Math.max(0, computedPercent));
                    }
                })
                .on('error', (err) => {
                    console.error(`Erro na otimização da parte ${part} para o arquivo ${file}:`, err.message);
                    cleanupOptimization(hash);
                })
                .on('end', async () => {
                    console.log(`Otimização finalizada com sucesso para a parte ${part} de: ${file}`);
                    try {
                        if (fs.existsSync(tempPath)) {
                            await fs.rename(tempPath, finalPath);
                            if (activeOptimizations[hash]) {
                                activeOptimizations[hash].finished = true;
                                activeOptimizations[hash].percent = 100;
                            }
                            console.log(`Arquivo otimizado da parte ${part} renomeado com sucesso: ${finalPath}`);
                        }
                    } catch (renameErr) {
                        console.error(`Erro ao renomear arquivo temporário de otimização:`, renameErr);
                        cleanupOptimization(hash);
                    }
                });

            activeOptimizations[hash] = {
                process: optimizationProcess,
                lastPoll: Date.now(),
                percent: 0,
                finished: false
            };

            optimizationProcess.run();

        } catch (setupErr) {
            console.error(`Falha ao iniciar processo de otimização para a parte ${part}:`, setupErr);
            cleanupOptimization(hash);
        }
    });

    // Retornar imediatamente informando que iniciou
    return res.json({
        success: true,
        finished: false,
        percent: 0,
        hash: hash
    });
});

app.get('/optimize-status', (req, res) => {
    const { hash } = req.query;
    if (!hash) {
        return res.status(400).json({ success: false, error: 'Hash não especificado' });
    }

    const finalFilename = 'optimized_' + hash + '.mp4';
    const finalPath = path.join(__dirname, SHARED_DIR, finalFilename);

    // Se o arquivo final já existe, está 100% pronto
    if (fs.existsSync(finalPath) && (!activeOptimizations[hash] || activeOptimizations[hash].finished)) {
        return res.json({
            success: true,
            finished: true,
            percent: 100,
            url: `/shared/${finalFilename}`,
            hash: hash
        });
    }

    const optimization = activeOptimizations[hash];
    if (optimization) {
        optimization.lastPoll = Date.now();
        return res.json({
            success: true,
            finished: optimization.finished,
            percent: Math.round(optimization.percent),
            url: `/shared/${finalFilename}`,
            hash: hash
        });
    }

    res.status(404).json({ success: false, error: 'Sessão de otimização não encontrada ou expirada.' });
});

app.post('/convert-to-mp4', async (req, res) => {
    const { file } = req.body;
    if (!file) {
        return res.status(400).json({ success: false, error: 'Arquivo não especificado' });
    }
    const fullPath = path.join(__dirname, SHARED_DIR, file);
    if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ success: false, error: 'Vídeo original não encontrado' });
    }

    // Validar extensão
    const ext = path.extname(file).toLowerCase();
    if (ext !== '.mkv') {
        return res.status(400).json({ success: false, error: 'Apenas arquivos MKV podem ser convertidos permanentemente.' });
    }

    // Nome do arquivo de saída permanente (substituir .mkv por .mp4)
    const outRelPath = file.substring(0, file.length - ext.length) + '.mp4';
    const outputPath = path.join(__dirname, SHARED_DIR, outRelPath);
    const tempOutputPath = outputPath + '.tmp';
    
    if (fs.existsSync(outputPath)) {
        return res.status(400).json({ success: false, error: 'O arquivo MP4 correspondente já existe no diretório.' });
    }

    const hash = getVideoHash(file + '_conversion');

    if (activeConversions[hash]) {
        return res.json({ success: true, hash: hash, message: 'Conversão já está em andamento.' });
    }

    // Remover resíduo de arquivo temporário anterior se existir
    if (fs.existsSync(tempOutputPath)) {
        try { fs.removeSync(tempOutputPath); } catch (e) {}
    }

    // Iniciar processo de conversão
    ffmpeg.ffprobe(fullPath, (err, metadata) => {
        let duration = 0;
        if (!err && metadata && metadata.format && metadata.format.duration) {
            duration = parseFloat(metadata.format.duration);
        }
        console.log(`Iniciando conversão permanente de ${file} para ${outRelPath}. Duração: ${duration}s`);

        const conversionProcess = ffmpeg(fullPath)
            .format('mp4')
            .videoCodec('libx264')
            .audioCodec('aac')
            .outputOptions([
                '-pix_fmt yuv420p',           // Compatibilidade de cor de 8 bits
                '-ac 2',                       // Downmix estéreo
                '-movflags +faststart',        // Faststart para reprodução rápida no navegador
                '-preset fast',                // Preset fast para melhor balanço de qualidade/velocidade
                '-crf 23'                      // CRF 23 para ótima qualidade permanente
            ])
            .output(tempOutputPath)
            .on('progress', (progress) => {
                if (activeConversions[hash]) {
                    let percent = 0;
                    if (progress.percent !== undefined) {
                        percent = progress.percent;
                    } else if (duration > 0 && progress.timemark) {
                        const parts = progress.timemark.split(':');
                        if (parts.length === 3) {
                            const hrs = parseFloat(parts[0]);
                            const mins = parseFloat(parts[1]);
                            const secs = parseFloat(parts[2]);
                            const elapsed = hrs * 3600 + mins * 60 + secs;
                            percent = (elapsed / duration) * 100;
                        }
                    }
                    activeConversions[hash].percent = Math.min(100, Math.max(0, percent));
                }
            })
            .on('error', (err) => {
                console.error(`Erro ao converter permanentemente ${file} para MP4:`, err.message);
                if (fs.existsSync(tempOutputPath)) {
                    try { fs.removeSync(tempOutputPath); } catch (e) {}
                }
                if (activeConversions[hash]) {
                    activeConversions[hash].error = err.message;
                    activeConversions[hash].finished = true;
                }
            })
            .on('end', () => {
                console.log(`Conversão permanente concluída com sucesso (temporário): ${tempOutputPath}`);
                try {
                    if (fs.existsSync(tempOutputPath)) {
                        fs.renameSync(tempOutputPath, outputPath);
                        console.log(`Arquivo renomeado com sucesso para: ${outputPath}`);
                    }
                } catch (renameErr) {
                    console.error('Erro ao renomear arquivo temporário convertido:', renameErr.message);
                    if (activeConversions[hash]) {
                        activeConversions[hash].error = 'Erro ao renomear o arquivo final: ' + renameErr.message;
                        activeConversions[hash].finished = true;
                        return;
                    }
                }
                if (activeConversions[hash]) {
                    activeConversions[hash].finished = true;
                    activeConversions[hash].percent = 100;
                }
            });

        activeConversions[hash] = {
            process: conversionProcess,
            tempOutputPath: tempOutputPath,
            percent: 0,
            finished: false,
            error: null,
            lastPoll: Date.now()
        };

        conversionProcess.run();
    });

    return res.json({ success: true, hash: hash, message: 'Conversão iniciada em segundo plano.' });
});

app.get('/conversion-status', (req, res) => {
    const { hash } = req.query;
    if (!hash) {
        return res.status(400).json({ success: false, error: 'Hash não especificado' });
    }
    const conversion = activeConversions[hash];
    if (conversion) {
        const result = {
            success: true,
            percent: Math.round(conversion.percent),
            finished: conversion.finished,
            error: conversion.error
        };
        // Se finalizado com erro ou sucesso, deletar do map após 30 segundos
        if (conversion.finished || conversion.error) {
            setTimeout(() => {
                delete activeConversions[hash];
            }, 30000);
        }
        return res.json(result);
    }
    res.status(404).json({ success: false, error: 'Conversão não encontrada ou já concluída.' });
});

app.get('/stream-video', (req, res) => {
    const file = req.query.file;
    if (!file) {
        return res.status(400).send('Arquivo não especificado');
    }
    const fullPath = path.join(__dirname, SHARED_DIR, file);
    
    if (!fs.existsSync(fullPath)) {
        return res.status(404).send('Vídeo não encontrado');
    }
    
    // Configura headers para streaming de vídeo fragmentado
    res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Transfer-Encoding': 'chunked'
    });
    
    ffmpeg(fullPath)
        .format('mp4')
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([
            '-movflags frag_keyframe+empty_moov',
            '-pix_fmt yuv420p',           // Garante compatibilidade de cor de 8 bits
            '-ac 2',                       // Força downmix estéreo para melhor suporte em TVs
            '-preset ultrafast',
            '-tune zerolatency',
            '-crf 28'
        ])
        .on('error', (err) => {
            console.error('Erro no stream do FFmpeg:', err.message);
            res.end();
        })
        .pipe(res, { end: true });
});

app.get('/videos', (req, res) => {
    const search = req.query.search || '';
    const baseDir = getAuthorizedPath(req, '');
    let files = getRecursiveFiles(path.join(__dirname, SHARED_DIR), baseDir);
    
    files = files.filter(f => f.name.match(/\.(mp4|webm|ogg|mkv|mov)$/i));
    
    if (search) {
        files = files.filter(f => f.name.toLowerCase().includes(search.toLowerCase()));
    }
    
    files.sort((a, b) => b.mtime - a.mtime);
    
    let filteredFavorites = favorites.filter(file => !isPathHidden(file, true));
    if (req.userGroup === 'customer') {
        filteredFavorites = filteredFavorites.filter(file => isPathAllowed(req, file));
    }
    res.render('library', { 
        type: 'videos', 
        title: 'Vídeos Recentes', 
        files, 
        search, 
        favorites: filteredFavorites 
    });
});

app.get('/photos', (req, res) => {
    const search = req.query.search || '';
    const baseDir = getAuthorizedPath(req, '');
    let files = getRecursiveFiles(path.join(__dirname, SHARED_DIR), baseDir);
    
    files = files.filter(f => f.name.match(/\.(jpg|jpeg|png|gif)$/i));
    
    if (search) {
        files = files.filter(f => f.name.toLowerCase().includes(search.toLowerCase()));
    }
    
    files.sort((a, b) => b.mtime - a.mtime);
    
    let filteredFavorites = favorites.filter(file => !isPathHidden(file, true));
    if (req.userGroup === 'customer') {
        filteredFavorites = filteredFavorites.filter(file => isPathAllowed(req, file));
    }
    res.render('library', { 
        type: 'photos', 
        title: 'Fotos Recentes', 
        files, 
        search, 
        favorites: filteredFavorites 
    });
});

app.get('/music', (req, res) => {
    const search = req.query.search || '';
    const baseDir = getAuthorizedPath(req, '');
    let files = getRecursiveFiles(path.join(__dirname, SHARED_DIR), baseDir);
    
    files = files.filter(f => f.name.match(/\.(mp3|wav|ogg|aac|flac)$/i));
    
    if (search) {
        files = files.filter(f => f.name.toLowerCase().includes(search.toLowerCase()));
    }
    
    files.sort((a, b) => b.mtime - a.mtime);
    
    let filteredFavorites = favorites.filter(file => !isPathHidden(file, true));
    if (req.userGroup === 'customer') {
        filteredFavorites = filteredFavorites.filter(file => isPathAllowed(req, file));
    }
    res.render('library', { 
        type: 'music', 
        title: 'Músicas Recentes', 
        files, 
        search, 
        favorites: filteredFavorites 
    });
});

app.get('/dashboard', (req, res) => {
    res.redirect('/');
});

app.get('/', (req, res) => {
    // 1. Calcular tamanho do banco de dados
    let camerasDbSize = 0;
    let favoritesDbSize = 0;
    try {
        if (fs.existsSync(CAMERAS_FILE)) {
            camerasDbSize = fs.statSync(CAMERAS_FILE).size;
        }
    } catch (e) {
        console.error("Erro ao calcular tamanho de cameras.json:", e);
    }
    try {
        if (fs.existsSync(FAVORITES_FILE)) {
            favoritesDbSize = fs.statSync(FAVORITES_FILE).size;
        }
    } catch (e) {
        console.error("Erro ao calcular tamanho de favorites.json:", e);
    }
    const totalDbSize = camerasDbSize + favoritesDbSize;

    // 2. Calcular estatísticas de arquivos da pasta shared
    let allFiles = [];
    try {
        // Obter todos os arquivos (sem os ocultos)
        const baseDir = getAuthorizedPath(req, '');
        allFiles = getRecursiveFiles(path.join(__dirname, SHARED_DIR), baseDir, true);
    } catch (e) {
        console.error("Erro ao ler arquivos do diretório compartilhado:", e);
    }

    let stats = {
        videos: { count: 0, size: 0 },
        photos: { count: 0, size: 0 },
        music: { count: 0, size: 0 },
        others: { count: 0, size: 0 }
    };

    allFiles.forEach(file => {
        const name = file.name.toLowerCase();
        if (name.match(/\.(mp4|webm|ogg|mkv|mov)$/i)) {
            stats.videos.count++;
            stats.videos.size += file.size;
        } else if (name.match(/\.(jpg|jpeg|png|gif)$/i)) {
            stats.photos.count++;
            stats.photos.size += file.size;
        } else if (name.match(/\.(mp3|wav|ogg|aac|flac)$/i)) {
            stats.music.count++;
            stats.music.size += file.size;
        } else {
            stats.others.count++;
            stats.others.size += file.size;
        }
    });

    const totalSharedFiles = allFiles.length;
    const totalSharedSize = allFiles.reduce((acc, f) => acc + f.size, 0);

    // Percentuais de uso de disco
    const videoPercentage = totalSharedSize > 0 ? ((stats.videos.size / totalSharedSize) * 100).toFixed(1) : 0;
    const photoPercentage = totalSharedSize > 0 ? ((stats.photos.size / totalSharedSize) * 100).toFixed(1) : 0;
    const musicPercentage = totalSharedSize > 0 ? ((stats.music.size / totalSharedSize) * 100).toFixed(1) : 0;
    const otherPercentage = totalSharedSize > 0 ? ((stats.others.size / totalSharedSize) * 100).toFixed(1) : 0;

    // Função de formatação helper
    function formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    const formattedStats = {
        videos: { 
            count: stats.videos.count, 
            size: formatBytes(stats.videos.size),
            percentage: videoPercentage
        },
        photos: { 
            count: stats.photos.count, 
            size: formatBytes(stats.photos.size),
            percentage: photoPercentage
        },
        music: { 
            count: stats.music.count, 
            size: formatBytes(stats.music.size),
            percentage: musicPercentage
        },
        others: { 
            count: stats.others.count, 
            size: formatBytes(stats.others.size),
            percentage: otherPercentage
        },
        db: {
            cameras: formatBytes(camerasDbSize),
            favorites: formatBytes(favoritesDbSize),
            total: formatBytes(totalDbSize)
        },
        shared: {
            count: totalSharedFiles,
            totalSize: formatBytes(totalSharedSize),
            rawTotalSize: totalSharedSize
        }
    };

    // 3. Obter vídeos assistidos recentemente (filtrar apenas os existentes e não ocultos)
    let recentlyPlayed = [];
    try {
        recentlyPlayed = historyList
            .filter(item => {
                const fullPath = path.join(__dirname, SHARED_DIR, item.file);
                // Excluir do histórico se o arquivo foi deletado ou foi ocultado pelo usuário, ou se o usuário não tiver permissão
                return fs.existsSync(fullPath) && !isPathHidden(item.file, true) && isPathAllowed(req, item.file);
            })
            .slice(0, 8)
            .map(item => {
                const fullPath = path.join(__dirname, SHARED_DIR, item.file);
                const stats = fs.statSync(fullPath);
                return {
                    name: path.basename(item.file),
                    path: item.file,
                    size: formatBytes(stats.size),
                    playedAt: new Date(item.playedAt).toLocaleString('pt-BR')
                };
            });
    } catch (e) {
        console.error("Erro ao processar histórico para renderização:", e);
    }

    // 4. Obter últimos uploads (sem os ocultos)
    let latestUploads = [];
    try {
        let filesCopy = [...allFiles];
        filesCopy.sort((a, b) => b.mtime - a.mtime);
        latestUploads = filesCopy.slice(0, 8).map(f => {
            return {
                name: f.name,
                path: f.path,
                size: formatBytes(f.size),
                mtime: new Date(f.mtime).toLocaleString('pt-BR')
            };
        });
    } catch (e) {
        console.error("Erro ao obter últimos uploads:", e);
    }

    let filteredFavorites = favorites.filter(file => !isPathHidden(file, true));
    if (req.userGroup === 'customer') {
        filteredFavorites = filteredFavorites.filter(file => isPathAllowed(req, file));
    }
    
    res.render('dashboard', {
        stats: formattedStats,
        favorites: filteredFavorites,
        recentlyPlayed,
        latestUploads
    });
});

app.get('/hidden-area', (req, res) => {
    // 1. Verificar autenticação via cookie temporário
    const cookieHeader = req.headers.cookie || '';
    const cookies = cookieHeader ? Object.fromEntries(cookieHeader.split('; ').map(c => {
        const parts = c.split('=');
        return [parts[0], decodeURIComponent(parts[1] || '')];
    })) : {};
    
    if (cookies.hidden_authenticated !== 'true') {
        return res.render('hidden_auth', { error: null });
    }

    // Limpar o cookie imediatamente para exigir autenticação no próximo carregamento
    res.clearCookie('hidden_authenticated', { path: '/' });

    // 2. Mapear arquivos ocultos
    const contents = hiddenFiles.map(filePath => {
        const fullPath = path.join(__dirname, SHARED_DIR, filePath);
        const exists = fs.existsSync(fullPath);
        const isFile = exists ? fs.statSync(fullPath).isFile() : true;
        let size = 0;
        try {
            if (exists) size = fs.statSync(fullPath).size;
        } catch (e) {}
        return {
            name: path.basename(filePath),
            path: filePath,
            isFile: isFile,
            size: size
        };
    });

    res.render('hidden_area', { contents });
});

app.post('/hidden-area/auth', express.urlencoded({ extended: true }), (req, res) => {
    const { password } = req.body;
    if (password === hiddenPassword) {
        res.cookie('hidden_authenticated', 'true', { maxAge: 10000, httpOnly: true, path: '/' }); // 10 segundos
        return res.redirect('/hidden-area');
    }
    res.render('hidden_auth', { error: 'incorrect_password' });
});

// Rotas de Autenticação Geral
app.get('/login', (req, res) => {
    if (!config.authEnabled) {
        return res.redirect('/');
    }
    const cookies = getCookies(req);
    if (cookies.authenticated === 'true') {
        return res.redirect('/');
    }
    res.render('login', { error: null, redirectTo: req.query.redirectTo || '' });
});

app.post('/login/auth', express.urlencoded({ extended: true }), (req, res) => {
    const { username, password, redirectTo } = req.body;
    const user = users.find(u => u.username.toLowerCase() === (username || '').trim().toLowerCase());
    
    if (user && user.password === password) {
        res.cookie('authenticated', 'true', { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, path: '/' });
        res.cookie('username', user.username, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, path: '/' });
        res.cookie('userGroup', user.group, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, path: '/' });
        
        // Se for customer, garante que o diretório sandbox próprio existe
        if (user.group === 'customer') {
            const userDir = path.join(__dirname, SHARED_DIR, 'users', user.username);
            fs.ensureDirSync(userDir);
        }
        
        return res.redirect(redirectTo || '/');
    }
    
    res.render('login', { error: 'invalid_credentials', redirectTo: redirectTo || '' });
});

app.get('/logout', (req, res) => {
    res.clearCookie('authenticated', { path: '/' });
    res.clearCookie('username', { path: '/' });
    res.clearCookie('userGroup', { path: '/' });
    res.redirect('/login');
});

// Rotas de Gerenciamento de Usuários (Apenas Admin)
app.get('/users', authMiddleware, (req, res) => {
    if (req.userGroup !== 'admin') {
        return res.status(403).send('Acesso negado: Apenas administradores podem gerenciar usuários.');
    }
    res.render('users', {
        users: users,
        currentUsername: req.username,
        error: req.query.error || null
    });
});

app.post('/users/add', authMiddleware, express.urlencoded({ extended: true }), (req, res) => {
    if (req.userGroup !== 'admin') {
        return res.status(403).send('Acesso negado: Apenas administradores podem gerenciar usuários.');
    }
    const { username, password, group } = req.body;
    
    // Normalizar e validar nome de usuário
    const cleanUsername = (username || '').trim().replace(/[^a-zA-Z0-9_]/g, '');
    if (!cleanUsername) {
        return res.redirect('/users?error=Nome%20de%20usuário%20inválido.%20Use%20apenas%20letras,%20números%20e%20sublinhados.');
    }

    const existingUser = users.find(u => u.username.toLowerCase() === cleanUsername.toLowerCase());
    if (existingUser) {
        return res.redirect('/users?error=Nome%20de%20usuário%20já%20está%20sendo%20utilizado.');
    }

    const newUser = {
        username: cleanUsername,
        password: password,
        group: group === 'admin' ? 'admin' : 'customer'
    };

    users.push(newUser);
    saveUsers();

    // Cria a pasta de arquivos própria do usuário (tanto admin quanto customer)
    const userDir = path.join(__dirname, SHARED_DIR, 'users', newUser.username);
    try {
        fs.ensureDirSync(userDir);
    } catch (err) {
        console.error(`Erro ao criar pasta home para o novo usuário ${newUser.username}:`, err);
    }

    res.redirect('/users');
});

app.post('/users/delete', authMiddleware, express.urlencoded({ extended: true }), (req, res) => {
    if (req.userGroup !== 'admin') {
        return res.status(403).send('Acesso negado: Apenas administradores podem gerenciar usuários.');
    }
    const { username } = req.body;

    if (username === req.username) {
        return res.redirect('/users?error=Você%20não%20pode%20excluir%20seu%20próprio%20usuário%20logado.');
    }

    const userIndex = users.findIndex(u => u.username === username);
    if (userIndex > -1) {
        users.splice(userIndex, 1);
        saveUsers();
    }

    res.redirect('/users');
});

// Rota do Controle Remoto Mobile
app.get('/remote', (req, res) => {
    res.render('remote', { config });
});

// Subnet scanner for local TVs (Roku) and open smart plugs (Shelly, Tasmota, Sonoff)
async function scanLocalSubnet() {
    const interfaces = os.networkInterfaces();
    let localIp = '';
    
    for (const devName in interfaces) {
        const iface = interfaces[devName];
        for (let i = 0; i < iface.length; i++) {
            const alias = iface[i];
            if (alias.family === 'IPv4' && !alias.internal) {
                localIp = alias.address;
                break;
            }
        }
        if (localIp) break;
    }
    
    if (!localIp || !localIp.startsWith('192.168.')) {
        localIp = '192.168.1.100';
    }
    
    const parts = localIp.split('.');
    const subnetBase = `${parts[0]}.${parts[1]}.${parts[2]}`;
    const discovered = [];
    
    // Helper to check if a TCP port is open
    const checkPort = (ip, port, timeout = 120) => {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            let status = false;
            socket.setTimeout(timeout);
            socket.connect(port, ip, () => {
                status = true;
                socket.destroy();
            });
            socket.on('timeout', () => socket.destroy());
            socket.on('error', () => socket.destroy());
            socket.on('close', () => resolve(status));
        });
    };
    
    const batchSize = 35;
    for (let i = 1; i <= 254; i += batchSize) {
        const promises = [];
        for (let j = 0; j < batchSize && (i + j) <= 254; j++) {
            const ip = `${subnetBase}.${i + j}`;
            if (ip === localIp) continue;
            
            promises.push((async () => {
                // Roku TV (8060)
                if (await checkPort(ip, 8060, 150)) {
                    try {
                        const res = await fetch(`http://${ip}:8060/query/device-info`, { timeout: 1000 });
                        if (res.ok) {
                            const text = await res.text();
                            const friendlyNameMatch = text.match(/<user-device-name>([^<]+)<\/user-device-name>/) || text.match(/<friendly-device-name>([^<]+)<\/friendly-device-name>/);
                            const name = friendlyNameMatch ? friendlyNameMatch[1] : `Roku TV (${ip})`;
                            discovered.push({
                                id: `media_player.roku_${ip.replace(/\./g, '_')}`,
                                name: name,
                                type: 'media_player',
                                state: 'off',
                                ip: ip,
                                protocol: 'roku'
                            });
                        }
                    } catch (e) {}
                }
                
                // Sonoff DIY/LAN Mode (8081)
                else if (await checkPort(ip, 8081, 150)) {
                    try {
                        const sonoffRes = await fetch(`http://${ip}:8081/zeroconf/info`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({}),
                            timeout: 1000
                        });
                        if (sonoffRes.ok) {
                            const sonoffData = await sonoffRes.json();
                            const devId = sonoffData.deviceid || `sonoff_${ip.replace(/\./g, '_')}`;
                            discovered.push({
                                id: `switch.${devId}`,
                                name: `Sonoff Plug (${ip})`,
                                type: 'switch',
                                state: 'off',
                                ip: ip,
                                protocol: 'sonoff',
                                deviceid: devId
                            });
                        }
                    } catch (e) {}
                }
                
                // Port 80 (Shelly or Tasmota)
                else if (await checkPort(ip, 80, 150)) {
                    try {
                        const shellyRes = await fetch(`http://${ip}/shelly`, { timeout: 800 });
                        if (shellyRes.ok) {
                            const shellyData = await shellyRes.json();
                            discovered.push({
                                id: `switch.shelly_${ip.replace(/\./g, '_')}`,
                                name: shellyData.name || `Shelly Plug (${ip})`,
                                type: 'switch',
                                state: 'off',
                                ip: ip,
                                protocol: 'shelly'
                            });
                            return;
                        }
                    } catch (e) {}
                    
                    try {
                        const tasmotaRes = await fetch(`http://${ip}/cm?cmnd=Status`, { timeout: 800 });
                        if (tasmotaRes.ok) {
                            const tasmotaData = await tasmotaRes.json();
                            discovered.push({
                                id: `switch.tasmota_${ip.replace(/\./g, '_')}`,
                                name: (tasmotaData.Status && tasmotaData.Status.DeviceName) || `Tasmota Plug (${ip})`,
                                type: 'switch',
                                state: 'off',
                                ip: ip,
                                protocol: 'tasmota'
                            });
                            return;
                        }
                    } catch (e) {}
                }
            })());
        }
        await Promise.all(promises);
    }
    
    return discovered;
}

// Controller for local devices
async function controlLocalDevice(device, params) {
    const protocol = device.protocol || 'mock';
    const ip = device.ip;
    
    if (protocol === 'roku') {
        if (params.state !== undefined) {
            await fetch(`http://${ip}:8060/keypress/Power`, { method: 'POST' });
        }
        if (params.mediaAction !== undefined) {
            let key = 'Play';
            if (params.mediaAction === 'volume_up') key = 'VolumeUp';
            else if (params.mediaAction === 'volume_down') key = 'VolumeDown';
            await fetch(`http://${ip}:8060/keypress/${key}`, { method: 'POST' });
        }
    }
    
    else if (protocol === 'shelly') {
        if (params.state !== undefined) {
            const turn = params.state === 'on' ? 'on' : 'off';
            await fetch(`http://${ip}/relay/0?turn=${turn}`);
        }
    }
    
    else if (protocol === 'tasmota') {
        if (params.state !== undefined) {
            const turn = params.state === 'on' ? 'On' : 'Off';
            await fetch(`http://${ip}/cm?cmnd=Power%20${turn}`);
        }
    }
    
    else if (protocol === 'sonoff') {
        if (params.state !== undefined) {
            const turn = params.state === 'on' ? 'on' : 'off';
            const body = JSON.stringify({
                deviceid: device.deviceid || '',
                data: {
                    switch: turn
                }
            });
            await fetch(`http://${ip}:8081/zeroconf/switch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body
            });
        }
    }
    
    else if (protocol === 'custom') {
        if (params.state !== undefined) {
            const url = params.state === 'on' ? device.onUrl : device.offUrl;
            if (url) await fetch(url);
        }
        if (params.brightness !== undefined && device.brightnessUrl) {
            const url = device.brightnessUrl.replace('{value}', params.brightness);
            await fetch(url);
        }
        if (params.temperature !== undefined && device.temperatureUrl) {
            const url = device.temperatureUrl.replace('{value}', params.temperature);
            await fetch(url);
        }
    }
    
    return true;
}

// Rota do Home Control / Alexa Mock
app.get('/home-control', (req, res) => {
    res.render('home_control', { config, devices });
});

// Rota do Chat AI (Dashboard de IA)
app.get(['/chat', '/ai'], (req, res) => {
    res.render('chat', { config, chatHistory, agentsList });
});

// Função Reutilizável de Processamento de Chat com AI e Comandos (Web & Telegram)
async function executeAgentChat(message, sessionId, agentId) {
    const hfToken = config.hfToken || process.env.HF_TOKEN || "";
    
    // 1. Resolver Session ID (Thread)
    const activeSessionId = sessionId || chatHistory.currentSessionId || 'default';
    if (!chatHistory.sessions[activeSessionId]) {
        chatHistory.sessions[activeSessionId] = {
            id: activeSessionId,
            title: 'Conversa Geral',
            timestamp: new Date().toISOString(),
            messages: []
        };
    }
    const session = chatHistory.sessions[activeSessionId];
    chatHistory.currentSessionId = activeSessionId;

    // 2. Resolver Agente (personalidade, modelo, temperatura)
    const activeAgentId = agentId || 'agent_default';
    const agent = agentsList.find(a => a.id === activeAgentId) || agentsList[0] || {
        name: config.agentName || 'Assistente Inteligente',
        skills: config.agentSkills || 'Especialista em recomendação de mídias, automação residencial e suporte técnico geral.',
        model: config.agentModel || 'meta-llama/Llama-3.1-8B-Instruct',
        temperature: config.agentTemperature !== undefined ? config.agentTemperature : 0.7
    };

    const agentModel = agent.model || config.agentModel || "meta-llama/Llama-3.1-8B-Instruct";
    const agentTemperature = !isNaN(parseFloat(agent.temperature)) ? parseFloat(agent.temperature) : 0.7;
    
    let skillsContext = '';
    try {
        const featuresFile = path.join(__dirname, 'skills', 'features-overview.md');
        if (fs.existsSync(featuresFile)) {
            skillsContext = await fs.readFile(featuresFile, 'utf8');
        }
    } catch (e) {
        console.error("Erro ao ler arquivo de skills:", e);
    }
    
    let tasksContext = '';
    try {
        const tasksFile = path.join(DATACACHE_DIR, 'tasks.json');
        if (fs.existsSync(tasksFile)) {
            const data = await fs.readJson(tasksFile);
            if (data && data.projects) {
                tasksContext = "Aqui está a lista de Projetos e Tarefas (Kanban) atuais cadastrados no sistema:\n\n";
                const today = new Date();
                today.setHours(0,0,0,0);
                
                Object.keys(data.projects).forEach(pId => {
                    const proj = data.projects[pId];
                    tasksContext += `Projeto: ${proj.name}\nDescrição: ${proj.description || 'Nenhuma'}\n`;
                    
                    const cols = proj.columns || {};
                    Object.keys(cols).forEach(colKey => {
                        const col = cols[colKey];
                        const cards = col.cards || [];
                        if (cards.length > 0) {
                            tasksContext += `  Status [${col.title}]:\n`;
                            cards.forEach(card => {
                                let statusInfo = '';
                                if (card.dueDate) {
                                    const dueDate = new Date(card.dueDate + 'T00:00:00');
                                    if (dueDate < today && colKey !== 'done') {
                                        statusInfo = ` (ATRASADA! Venceu em: ${card.dueDate})`;
                                    } else {
                                        statusInfo = ` (Vence em: ${card.dueDate})`;
                                    }
                                }
                                tasksContext += `    - [ID: ${card.id}] ${card.title}${card.description ? ` (${card.description})` : ''}${card.category ? ` [Categoria: ${card.category}]` : ''}${card.labels && card.labels.length > 0 ? ` {Etiquetas: ${card.labels.join(', ')}}` : ''}${statusInfo}\n`;
                            });
                        }
                    });
                    tasksContext += "\n";
                });
            }
        }
    } catch (e) {
        console.error("Erro ao ler tasks.json para contexto do chat:", e);
    }
    
    let filesContext = '';
    try {
        const ragDir = path.join(__dirname, config.agentRagDir || 'public/shared');
        if (fs.existsSync(ragDir)) {
            const files = fs.readdirSync(ragDir).filter(f => fs.lstatSync(path.join(ragDir, f)).isFile());
            if (files.length > 0) {
                filesContext = "Aqui está a lista de Arquivos Compartilhados disponíveis no sistema que o usuário pode solicitar:\n" + files.map(f => `- ${f}`).join('\n') + "\n\n";
            }
        }
    } catch (e) {
        console.error("Erro ao ler arquivos RAG:", e);
    }
    
    const systemPrompt = `Você é o ${agent.name || 'Assistente Inteligente'}.
Suas habilidades: ${agent.skills || 'Especialista em recomendação de mídias, automação residencial e suporte técnico geral.'}
Suas respostas devem considerar as informações e arquivos na pasta RAG: ${config.agentRagDir || 'public/shared'}.

${skillsContext ? `Aqui está o manual de funcionalidades do aplicativo (utilize isso para responder se o usuário perguntar sobre o que o app faz ou para que serve):\n\n${skillsContext}` : ''}

${tasksContext ? `Aqui está o monitoramento em tempo real dos projetos e tarefas:\n\n${tasksContext}` : ''}

${filesContext ? `${filesContext}` : ''}

Se o usuário solicitar ações de alteração de tarefas (como criar, mover, concluir, colocar em validation ou excluir tarefas), você deve responder de forma amigável confirmando a ação E obrigatoriamente incluir no final da resposta um bloco JSON contendo o comando correspondente.

Se o usuário solicitar ou pedir qualquer arquivo da lista de arquivos compartilhados fornecida acima, você deve responder confirmando que enviará o arquivo E obrigatoriamente incluir no final da resposta o seguinte bloco JSON:
\`\`\`json
{
  "action": "send_file",
  "filename": "NOME_DO_ARQUIVO"
}
\`\`\`

IMPORTANTE: 
- Se o usuário solicitar uma ação em uma tarefa (como mover, concluir ou excluir) e existir mais de uma tarefa com título similar em projetos diferentes, NÃO gere o comando JSON ainda. Em vez disso, pergunte ao usuário de qual projeto ele se refere, numerando as opções de projetos de 1 a X (ex: "1. Projeto A, 2. Projeto B"). Só envie o comando JSON quando o usuário escolher e esclarecer de qual projeto é a tarefa.
- Se o usuário solicitar para criar, adicionar ou persistir uma anotação/nota e houver qualquer ambiguidade ou você tiver dúvidas se a nova informação deve ser anexada/adicionada à conversa/nota anterior ou se deve criar uma nova ação separada, NÃO gere o comando JSON ainda. Pergunte primeiro ao usuário para confirmar: "Você deseja adicionar esta informação na nota anterior ou criar uma nova anotação?". Só gere o comando JSON após o esclarecimento dele.

ATENÇÃO: Mantenha estritamente o formato JSON abaixo para que o servidor execute a ação no banco de dados:

Para Mover/Concluir:
\`\`\`json
{
  "action": "move_task",
  "taskId": "ID_DA_TAREFA",
  "targetColumn": "todo" ou "doing" ou "validation" ou "done"
}
\`\`\`

Para Criar:
\`\`\`json
{
  "action": "create_task",
  "projectId": "ID_DO_PROJETO" (se não especificado use "proj_default"),
  "title": "Título da Tarefa",
  "description": "Descrição",
  "category": "Categoria",
  "labels": ["Etiqueta1", "Etiqueta2"],
  "labelColor": "default" ou "red" ou "blue" or "green" ou "yellow" ou "purple",
  "dueDate": "YYYY-MM-DD"
}
\`\`\`

Para Deletar:
\`\`\`json
{
  "action": "delete_task",
  "taskId": "ID_DA_TAREFA"
}
\`\`\`

Para Criar Nota (Lembrete/Dieta/Treino/Anotação):
- Você deve extrair o assunto e o conteúdo da nota diretamente do texto enviado pelo usuário. O campo "title" deve ser um resumo curto (ex: "Teste do Notes") e o campo "content" deve refletir o texto completo que o usuário solicitou registrar.
- IMPORTANTE: NUNCA invente ou use placeholders/títulos genéricos como "Desenvolvimento em progresso" se o usuário especificou o assunto ou se a mensagem dele já indica o que deve ser anotado.
\`\`\`json
{
  "action": "create_note",
  "title": "Título Resumido",
  "content": "Conteúdo real extraído da solicitação"
}
\`\`\`

Para Adicionar Comentário/Feedback a uma Tarefa:
\`\`\`json
{
  "action": "add_comment",
  "taskId": "ID_DA_TAREFA" (ou título aproximado da tarefa para busca por similaridade),
  "text": "Texto do comentário"
}
\`\`\`
Não invente IDs. Utilize exatamente os IDs das tarefas listadas acima no monitoramento (por exemplo, "task_1").`;
    
    const historyMsgs = session.messages.slice(-10).map(msg => {
        let content = msg.content || '';
        if (content.startsWith('[Proactive follow-up from')) {
            content = content.replace(/^\[Proactive follow-up from [^\]]+\]\n/, '');
        }
        return { role: msg.role, content };
    });
    
    console.log(`[executeAgentChat] Iniciando completions no modelo: ${agentModel} para a mensagem: "${message.substring(0, 30)}..."`);
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 15000); // 15s timeout
    
    let response;
    try {
        response = await fetch(`https://router.huggingface.co/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${hfToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: agentModel,
                messages: [
                    { role: "system", content: systemPrompt },
                    ...historyMsgs,
                    { role: "user", content: message }
                ],
                temperature: agentTemperature,
                max_tokens: 800
            }),
            signal: abortController.signal
        });
        clearTimeout(timeoutId);
        console.log(`[executeAgentChat] API Hugging Face respondeu com status: ${response.status}`);
    } catch (err) {
        clearTimeout(timeoutId);
        console.error(`[executeAgentChat] Erro/Timeout na conexao com Hugging Face:`, err.message);
        throw err;
    }

    if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Erro na API Hugging Face (Status: ${response.status}): ${errBody}`);
    }

    const resData = await response.json();
    let reply = resData.choices && resData.choices[0] && resData.choices[0].message ? resData.choices[0].message.content : 'Não obtive resposta.';
    
    let actionExecuted = false;
    
    // Procurar por bloco JSON de comando de tarefa na resposta da AI
    const jsonMatch = reply.match(/```json\s*([\s\S]+?)\s*```/) || reply.match(/(\{\s*"(action|projectId|taskId|title|content)"[\s\S]*?\})/);
    if (jsonMatch) {
        try {
            const command = JSON.parse(jsonMatch[1] || jsonMatch[0]);
            if (command && command.action) {
                if (command.action === 'create_note') {
                    const newNote = {
                        id: 'note_' + Math.random().toString(36).substring(2, 9),
                        title: command.title || 'Nova Anotação AI',
                        content: command.content || '',
                        createdBy: agent.name || 'Assistente de AI',
                        agentId: agent.id || null,
                        timestamp: new Date().toISOString()
                    };
                    notesList.push(newNote);
                    await saveNotesAsync();
                    actionExecuted = true;
                }
                if (command.action === 'add_comment') {
                    const taskId = command.taskId;
                    const textComment = command.text;
                    const authorLabel = sessionId.startsWith('telegram_') ? 'Telegram User' : 'Chat AI';
                    
                    const tasksFile = path.join(DATACACHE_DIR, 'tasks.json');
                    if (fs.existsSync(tasksFile)) {
                        let tData = await fs.readJson(tasksFile);
                        let found = false;
                        
                        Object.keys(tData.projects).forEach(projId => {
                            const proj = tData.projects[projId];
                            Object.keys(proj.columns).forEach(colId => {
                                proj.columns[colId].cards.forEach(card => {
                                    const cleanTaskId = String(taskId).toLowerCase();
                                    const cleanTitle = card.title.toLowerCase();
                                    if (card.id === taskId || cleanTitle.includes(cleanTaskId) || cleanTaskId.includes(cleanTitle)) {
                                        if (!card.comments) card.comments = [];
                                        card.comments.push({
                                            id: 'comment_' + Math.random().toString(36).substring(2, 9),
                                            author: authorLabel,
                                            text: textComment,
                                            timestamp: new Date().toISOString()
                                        });
                                        found = true;
                                    }
                                });
                            });
                        });
                        
                        if (found) {
                            tasksData = tData;
                            await saveTasksAsync();
                            actionExecuted = true;
                        }
                    }
                }
                if (command.action === 'send_file') {
                    const filename = command.filename;
                    const filePath = path.join(__dirname, config.agentRagDir || 'public/shared', filename);
                    if (fs.existsSync(filePath)) {
                        if (sessionId.startsWith('telegram_')) {
                            const chatId = sessionId.replace('telegram_', '');
                            sendTelegramDocument(chatId, filePath, `Aqui está o arquivo solicitado: ${filename}`);
                            actionExecuted = true;
                        } else {
                            reply += `\n\n📥 **[Clique aqui para baixar o arquivo ${filename}](/shared/${encodeURIComponent(filename)})**`;
                        }
                    } else {
                        reply += `\n\n⚠️ O arquivo solicitado *${filename}* não foi encontrado no sistema.`;
                    }
                }
                const tasksFile = path.join(DATACACHE_DIR, 'tasks.json');
                if (fs.existsSync(tasksFile)) {
                    let tData = await fs.readJson(tasksFile);
                    if (tData && tData.projects) {
                        if (command.action === 'move_task' || command.action === 'update_task') {
                            let found = false;
                            Object.keys(tData.projects).forEach(projId => {
                                const proj = tData.projects[projId];
                                let taskCard = null;
                                let sourceCol = '';
                                
                                // 1. Procurar por ID exato
                                Object.keys(proj.columns).forEach(colId => {
                                    const idx = proj.columns[colId].cards.findIndex(c => c.id === command.taskId);
                                    if (idx !== -1) {
                                        taskCard = proj.columns[colId].cards[idx];
                                        sourceCol = colId;
                                    }
                                });
                                
                                // 2. Fallback: procurar por título caso o ID falhe
                                if (!taskCard && command.taskId) {
                                    const cleanSearch = command.taskId.toLowerCase();
                                    Object.keys(proj.columns).forEach(colId => {
                                        const idx = proj.columns[colId].cards.findIndex(c => 
                                            c.title.toLowerCase().includes(cleanSearch) || 
                                            cleanSearch.includes(c.title.toLowerCase())
                                        );
                                        if (idx !== -1) {
                                            taskCard = proj.columns[colId].cards[idx];
                                            sourceCol = colId;
                                        }
                                    });
                                }
                                
                                if (taskCard && command.targetColumn && proj.columns[command.targetColumn]) {
                                    // Remover da coluna anterior
                                    proj.columns[sourceCol].cards = proj.columns[sourceCol].cards.filter(c => c.id !== taskCard.id);
                                    taskCard.mtime = new Date().toISOString();
                                    // Adicionar na nova
                                    proj.columns[command.targetColumn].cards.push(taskCard);
                                    found = true;
                                }
                            });
                            
                            if (found) {
                                tasksData = tData;
                                await saveTasksAsync();
                                actionExecuted = true;
                            }
                        }
                        
                        else if (command.action === 'create_task') {
                            const projId = command.projectId || 'proj_default';
                            const proj = tData.projects[projId];
                            if (proj) {
                                const newCard = {
                                    id: 'card_' + Math.random().toString(36).substring(2, 9),
                                    title: command.title || 'Nova Tarefa AI',
                                    description: command.description || '',
                                    category: command.category || 'AI',
                                    labelColor: command.labelColor || 'default',
                                    labels: command.labels || [],
                                    dueDate: command.dueDate || '',
                                    mtime: new Date().toISOString()
                                };
                                proj.columns.todo.cards.push(newCard);
                                tasksData = tData;
                                await saveTasksAsync();
                                actionExecuted = true;
                            }
                        }
                        
                        else if (command.action === 'delete_task') {
                            let found = false;
                            Object.keys(tData.projects).forEach(projId => {
                                const proj = tData.projects[projId];
                                Object.keys(proj.columns).forEach(colId => {
                                    const initialLen = proj.columns[colId].cards.length;
                                    proj.columns[colId].cards = proj.columns[colId].cards.filter(c => c.id !== command.taskId);
                                    if (proj.columns[colId].cards.length < initialLen) {
                                        found = true;
                                    }
                                });
                            });
                            
                            if (found) {
                                tasksData = tData;
                                await saveTasksAsync();
                                actionExecuted = true;
                            }
                        }
                    }
                }
            }
        } catch (err) {
            console.error("Erro ao executar comando da AI:", err);
        }
    }

    // Salvar mensagem do usuário e resposta da AI no histórico da sessão
    session.messages.push({ role: 'user', content: message, timestamp: new Date().toISOString() });
    session.messages.push({ role: 'assistant', content: reply, timestamp: new Date().toISOString() });
    
    // Nomear a conversa se for a primeira mensagem
    if (session.messages.length <= 2 && message.length > 5) {
        session.title = message.substring(0, 30) + (message.length > 30 ? '...' : '');
    }
    saveChatHistory();

    // Salvar resposta no centro de notificações do sistema
    notifications.unshift({
        id: 'notif_' + Math.random().toString(36).substring(2, 9),
        title: `💬 Mensagem de ${agent.name || 'Assistente de AI'}`,
        message: reply,
        type: 'info',
        timestamp: new Date().toISOString(),
        read: false
    });
    saveNotifications();

    return {
        reply,
        actionExecuted,
        activeSessionId,
        sessionTitle: session.title,
        usage: resData.usage
    };
}

// API do Chat AI (Hugging Face com Suporte a Multi-Agente e Multi-Thread)
app.post('/api/chat', express.json(), async (req, res) => {
    const { message, sessionId, agentId } = req.body;
    
    if (!message) {
        return res.status(400).json({ success: false, error: 'Mensagem vazia' });
    }

    try {
        const result = await executeAgentChat(message, sessionId, agentId);
        res.json({
            success: true,
            response: result.reply,
            usage: result.usage,
            refreshTasks: result.actionExecuted,
            sessionId: result.activeSessionId,
            sessionTitle: result.sessionTitle
        });
    } catch (error) {
        console.error("Erro no Chat AI:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// APIs para controle de threads/sessoes de chat
app.post('/api/chat/session/create', express.json(), (req, res) => {
    const sessionId = 'sess_' + Math.random().toString(36).substring(2, 9);
    const title = req.body.title || 'Nova Conversa';
    
    chatHistory.sessions[sessionId] = {
        id: sessionId,
        title: title,
        timestamp: new Date().toISOString(),
        messages: []
    };
    chatHistory.currentSessionId = sessionId;
    saveChatHistory();
    res.json({ success: true, sessionId, title });
});

// API: Adicionar Comentário a uma Tarefa
app.post('/api/tasks/comment/add', express.json(), async (req, res) => {
    const { taskId, commentId, author, text, attachments } = req.body;
    if (!taskId || !text) {
        return res.status(400).json({ success: false, error: 'Parâmetros inválidos' });
    }

    const tasksFile = path.join(DATACACHE_DIR, 'tasks.json');
    try {
        let tData = await fs.readJson(tasksFile);
        let found = false;

        Object.keys(tData.projects).forEach(projId => {
            const proj = tData.projects[projId];
            Object.keys(proj.columns).forEach(colId => {
                proj.columns[colId].cards.forEach(card => {
                    if (card.id === taskId) {
                        if (!card.comments) card.comments = [];
                        card.comments.push({
                            id: commentId || ('comment_' + Math.random().toString(36).substring(2, 9)),
                            author: author || 'Sistema',
                            text: text,
                            timestamp: new Date().toISOString(),
                            attachments: attachments || []
                        });
                        found = true;
                    }
                });
            });
        });

        if (found) {
            tasksData = tData;
            await saveTasksAsync();
            res.json({ success: true, tasks: tasksData });
        } else {
            res.status(404).json({ success: false, error: 'Tarefa não encontrada' });
        }
    } catch (err) {
        console.error("Erro ao adicionar comentário à tarefa:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Editar Comentário de uma Tarefa
app.post('/api/tasks/comment/edit', express.json(), async (req, res) => {
    const { taskId, commentId, text, attachments } = req.body;
    if (!taskId || !commentId || !text) {
        return res.status(400).json({ success: false, error: 'Parâmetros inválidos' });
    }

    const tasksFile = path.join(DATACACHE_DIR, 'tasks.json');
    try {
        let tData = await fs.readJson(tasksFile);
        let found = false;

        Object.keys(tData.projects).forEach(projId => {
            const proj = tData.projects[projId];
            Object.keys(proj.columns).forEach(colId => {
                proj.columns[colId].cards.forEach(card => {
                    if (card.id === taskId && card.comments) {
                        const comment = card.comments.find(c => c.id === commentId);
                        if (comment) {
                            comment.text = text;
                            if (attachments) {
                                comment.attachments = attachments;
                            }
                            comment.mtime = new Date().toISOString();
                            found = true;
                        }
                    }
                });
            });
        });

        if (found) {
            tasksData = tData;
            await saveTasksAsync();
            res.json({ success: true, tasks: tasksData });
        } else {
            res.status(404).json({ success: false, error: 'Comentário ou Tarefa não encontrada' });
        }
    } catch (err) {
        console.error("Erro ao editar comentário da tarefa:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Excluir Comentário de uma Tarefa
app.post('/api/tasks/comment/delete', express.json(), async (req, res) => {
    const { taskId, commentId } = req.body;
    if (!taskId || !commentId) {
        return res.status(400).json({ success: false, error: 'Parâmetros inválidos' });
    }

    const tasksFile = path.join(DATACACHE_DIR, 'tasks.json');
    try {
        let tData = await fs.readJson(tasksFile);
        let found = false;

        Object.keys(tData.projects).forEach(projId => {
            const proj = tData.projects[projId];
            Object.keys(proj.columns).forEach(colId => {
                proj.columns[colId].cards.forEach(card => {
                    if (card.id === taskId && card.comments) {
                        const originalLength = card.comments.length;
                        card.comments = card.comments.filter(c => c.id !== commentId);
                        if (card.comments.length < originalLength) {
                            found = true;
                        }
                    }
                });
            });
        });

        if (found) {
            tasksData = tData;
            await saveTasksAsync();
            res.json({ success: true, tasks: tasksData });
        } else {
            res.status(404).json({ success: false, error: 'Comentário ou Tarefa não encontrada' });
        }
    } catch (err) {
        console.error("Erro ao excluir comentário da tarefa:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/chat/session/delete', express.json(), (req, res) => {
    const { sessionId } = req.body;
    if (sessionId && chatHistory.sessions[sessionId]) {
        delete chatHistory.sessions[sessionId];
        if (chatHistory.currentSessionId === sessionId) {
            const keys = Object.keys(chatHistory.sessions);
            chatHistory.currentSessionId = keys.length > 0 ? keys[0] : 'default';
            if (!chatHistory.sessions[chatHistory.currentSessionId]) {
                chatHistory.sessions['default'] = {
                    id: 'default',
                    title: 'Conversa Geral',
                    timestamp: new Date().toISOString(),
                    messages: []
                };
                chatHistory.currentSessionId = 'default';
            }
        }
        saveChatHistory();
        return res.json({ success: true, currentSessionId: chatHistory.currentSessionId });
    }
    res.status(404).json({ success: false, error: 'Sessão não encontrada' });
});

// APIs para controle de criação de novos agentes
app.post('/api/agents/create', express.json(), (req, res) => {
    const { name, profile, skills, model, temperature, isPublic, isProactive } = req.body;
    if (!name || !skills) {
        return res.status(400).json({ success: false, error: 'Nome e Habilidades são obrigatórios.' });
    }
    
    const newAgent = {
        id: 'agent_' + Math.random().toString(36).substring(2, 9),
        name,
        profile: profile || 'Geral',
        skills,
        model: model || 'meta-llama/Llama-3.1-8B-Instruct',
        temperature: !isNaN(parseFloat(temperature)) ? parseFloat(temperature) : 0.7,
        isPublic: isPublic === true || isPublic === 'true',
        isProactive: isProactive === true || isProactive === 'true'
    };
    
    agentsList.push(newAgent);
    saveAgents();
    res.json({ success: true, agent: newAgent });
});

// API para obter histórico da sessão atual do Chat AI
app.get('/api/chat/history', (req, res) => {
    const activeSessionId = chatHistory.currentSessionId || 'default';
    const session = chatHistory.sessions[activeSessionId] || chatHistory.sessions['default'];
    res.json({ success: true, history: session ? session.messages : [] });
});

// API: Telegram Bot Diagnostic Self-Test
app.get('/api/telegram/selftest', async (req, res) => {
    const report = {
        telegramConfigured: !!config.telegramBotToken,
        telegramEnabled: !!config.telegramBotEnabled,
        telegramApiOk: false,
        telegramBotInfo: null,
        telegramError: null,
        huggingFaceOk: false,
        huggingFaceError: null,
        databases: {
            config: false,
            tasks: false,
            notes: false,
            subscribers: false
        },
        subscribersCount: (typeof telegramSubscribers !== 'undefined') ? telegramSubscribers.length : 0
    };

    // 1. Validar bancos de dados
    try {
        report.databases.config = fs.existsSync(CONFIG_FILE);
        report.databases.tasks = fs.existsSync(path.join(DATACACHE_DIR, 'tasks.json'));
        report.databases.notes = fs.existsSync(path.join(DATACACHE_DIR, 'notes.json'));
        report.databases.subscribers = fs.existsSync(path.join(DATACACHE_DIR, 'telegram_subscribers.json'));
    } catch (e) {}

    // 2. Testar API do Telegram
    if (config.telegramBotToken) {
        try {
            const botInfo = await new Promise((resolve, reject) => {
                const apiReq = https.get(`https://api.telegram.org/bot${config.telegramBotToken}/getMe`, (apiRes) => {
                    let body = '';
                    apiRes.on('data', chunk => body += chunk);
                    apiRes.on('end', () => {
                        try {
                            const data = JSON.parse(body);
                            if (data.ok) {
                                resolve(data.result);
                            } else {
                                reject(new Error(data.description || 'Token inválido'));
                            }
                        } catch (e) {
                            reject(e);
                        }
                    });
                });
                apiReq.on('error', reject);
            });
            report.telegramApiOk = true;
            report.telegramBotInfo = botInfo;
        } catch (err) {
            report.telegramError = err.message;
        }
    }

    // 3. Testar Hugging Face Router
    if (config.hfToken) {
        try {
            const hfRes = await fetch(`https://router.huggingface.co/v1/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${config.hfToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: config.agentModel || 'meta-llama/Llama-3.1-8B-Instruct',
                    messages: [{ role: 'user', content: 'ping' }],
                    max_tokens: 3
                })
            });
            if (hfRes.ok) {
                report.huggingFaceOk = true;
            } else {
                report.huggingFaceError = `Status ${hfRes.status}: ${await hfRes.text()}`;
            }
        } catch (err) {
            report.huggingFaceError = err.message;
        }
    }

    res.json(report);
});

// API: Obter Logs de Invocação da AI pelo Telegram
app.get('/api/telegram/logs', (req, res) => {
    try {
        const logFile = path.join(DATACACHE_DIR, 'telegram_ai_logs.json');
        let logs = [];
        if (fs.existsSync(logFile)) {
            logs = fs.readJsonSync(logFile) || [];
        }
        res.json({ success: true, logs });
    } catch (e) {
        console.error("Erro ao ler logs do Telegram AI:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// API: Obter Lista de Notas (Lembretes)
app.get('/api/notes/list', (req, res) => {
    res.json({ success: true, notes: notesList });
});

// Rota do App de Notas (Notes / Lembretes)
app.get('/notes', (req, res) => {
    res.render('notes', { config, notesList, agentsList });
});

// Configuração de Multer para upload de anexo nas Notas
const notesUploadStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, config.agentRagDir || 'public/shared'));
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const originalName = file.originalname || 'file';
        cb(null, uniqueSuffix + '-' + originalName);
    }
});
const notesUpload = multer({ storage: notesUploadStorage });

// API: Criar Nota (Aceita JSON ou Multipart com arquivo de anexo)
app.post('/api/notes/create', (req, res, next) => {
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('multipart/form-data')) {
        notesUpload.single('attachment')(req, res, next);
    } else {
        express.json()(req, res, next);
    }
}, async (req, res) => {
    const { title, content, createdBy, agentId } = req.body;
    if (!title || !content) {
        return res.status(400).json({ success: false, error: 'Título e Conteúdo são obrigatórios.' });
    }
    
    let finalContent = content;
    if (req.file) {
        finalContent += `\n\n📥 **[Anexo: ${req.file.originalname}](/shared/${req.file.filename})**`;
    }
    
    const newNote = {
        id: 'note_' + Math.random().toString(36).substring(2, 9),
        title,
        content: finalContent,
        createdBy: createdBy || 'Human',
        agentId: agentId || null,
        timestamp: new Date().toISOString()
    };
    
    notesList.push(newNote);
    await saveNotesAsync();
    res.json({ success: true, note: newNote });
});

// API: Deletar Nota
app.post('/api/notes/delete', express.json(), (req, res) => {
    const { noteId } = req.body;
    if (noteId) {
        const initialLen = notesList.length;
        notesList = notesList.filter(n => n.id !== noteId);
        if (notesList.length < initialLen) {
            saveNotes();
            return res.json({ success: true });
        }
    }
    res.status(404).json({ success: false, error: 'Nota não encontrada' });
});

// API de Alertas Proativos de Tarefas e Lembretes
app.get('/api/tasks/alerts', (req, res) => {
    try {
        const tasksFile = path.join(DATACACHE_DIR, 'tasks.json');
        if (!fs.existsSync(tasksFile)) {
            return res.json({ showAlert: false });
        }
        
        const data = fs.readJsonSync(tasksFile);
        if (!data || !data.projects) {
            return res.json({ showAlert: false });
        }
        
        const today = new Date();
        today.setHours(0,0,0,0);
        let overdueTasks = [];
        let pendingTasks = [];
        
        Object.keys(data.projects).forEach(projId => {
            const proj = data.projects[projId];
            const cols = proj.columns || {};
            
            Object.keys(cols).forEach(colId => {
                if (colId === 'done') return;
                
                const cards = cols[colId].cards || [];
                cards.forEach(card => {
                    if (card.dueDate) {
                        const dueDate = new Date(card.dueDate + 'T00:00:00');
                        if (dueDate < today) {
                            overdueTasks.push({ title: card.title, project: proj.name, dueDate: card.dueDate, id: card.id });
                        } else {
                            const diffTime = Math.abs(dueDate - today);
                            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                            if (diffDays <= 3) {
                                pendingTasks.push({ title: card.title, project: proj.name, dueDate: card.dueDate, id: card.id });
                            }
                        }
                    }
                });
            });
        });
        
        if (overdueTasks.length === 0 && pendingTasks.length === 0) {
            return res.json({ showAlert: false });
        }
        
        // Construção da mensagem amigável e natural
        let alertMessage = `Olá! Sou o **${config.agentName || 'Assistente Inteligente'}** do BlackBird.\n\nNotei que você possui atividades importantes pendentes:\n\n`;
        
        if (overdueTasks.length > 0) {
            alertMessage += `⚠️ **Atrasadas:**\n`;
            overdueTasks.forEach(t => {
                const dateParts = t.dueDate.split('-');
                const formattedDate = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
                alertMessage += `- **${t.title}** (Venceu em: *${formattedDate}* - ID: \`${t.id}\` no projeto *${t.project}*)\n`;
            });
            alertMessage += `\n`;
        }
        
        if (pendingTasks.length > 0) {
            alertMessage += `📅 **Próximas do Vencimento:**\n`;
            pendingTasks.forEach(t => {
                const dateParts = t.dueDate.split('-');
                const formattedDate = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
                alertMessage += `- **${t.title}** (Vence em: *${formattedDate}* - ID: \`${t.id}\` no projeto *${t.project}*)\n`;
            });
            alertMessage += `\n`;
        }
        
        alertMessage += `Como gostaria de prosseguir? Se já finalizou alguma delas, basta me responder aqui (ex: *"concluí a tarefa ${overdueTasks[0]?.id || pendingTasks[0]?.id || ''}"*) que eu a moverei automaticamente para a coluna **Done**!`;
        
        // Evita duplicar alertas idênticos no histórico de chat
        const activeSessionId = chatHistory.currentSessionId || 'default';
        if (!chatHistory.sessions[activeSessionId]) {
            chatHistory.sessions[activeSessionId] = {
                id: activeSessionId,
                title: 'Conversa Geral',
                timestamp: new Date().toISOString(),
                messages: []
            };
        }
        const session = chatHistory.sessions[activeSessionId];
        const lastMsg = session.messages[session.messages.length - 1];
        if (!lastMsg || lastMsg.content !== alertMessage) {
            session.messages.push({ role: "assistant", content: alertMessage, timestamp: new Date().toISOString() });
            saveChatHistory();
        }

        // Salvar nas notificações do sistema se for a primeira vez na sessão ou se não houver duplicada não lida
        const hasUnreadDuplicate = notifications.some(n => n.message === alertMessage && !n.read);
        if (!hasUnreadDuplicate) {
            notifications.unshift({
                id: 'notif_' + Math.random().toString(36).substring(2, 9),
                title: overdueTasks.length > 0 ? '⚠️ Alerta: Atividades Atrasadas' : '📅 Lembrete: Próximos Vencimentos',
                message: alertMessage,
                type: overdueTasks.length > 0 ? 'alert' : 'info',
                timestamp: new Date().toISOString(),
                read: false
            });
            saveNotifications();
        }
        
        res.json({ showAlert: true, message: alertMessage });
    } catch (e) {
        console.error("Erro ao gerar alertas proativos:", e);
        res.json({ showAlert: false });
    }
});

// Rota de Notificações do Sistema
app.get('/notifications', (req, res) => {
    res.render('notifications', { config, notificationsList: notifications });
});

// APIs de Notificações
app.post('/api/notifications/read-all', (req, res) => {
    notifications.forEach(n => n.read = true);
    saveNotifications();
    res.json({ success: true });
});

app.post('/api/notifications/clear', (req, res) => {
    notifications.length = 0;
    saveNotifications();
    res.json({ success: true });
});

app.post('/api/notifications/toggle-read', express.json(), (req, res) => {
    const { id } = req.body;
    const notif = notifications.find(n => n.id === id);
    if (notif) {
        notif.read = !notif.read;
        saveNotifications();
        return res.json({ success: true, read: notif.read });
    }
    res.status(404).json({ success: false, error: 'Notificação não encontrada' });
});

// API de Auto-sugestões de pesquisa
app.get('/api/search/suggestions', (req, res) => {
    const query = req.query.q || '';
    if (!query || query.trim().length < 2) {
        return res.json({ success: true, suggestions: [] });
    }
    try {
        let files = getRecursiveFiles(path.join(__dirname, SHARED_DIR));
        if (req.userGroup === 'customer') {
            files = files.filter(f => isPathAllowed(req, f.path));
        }
        
        // Filtrar por query
        const filtered = files.filter(f => f.name.toLowerCase().includes(query.toLowerCase()));
        
        // Ordenar por data
        filtered.sort((a, b) => b.mtime - a.mtime);
        
        // Limitar a 8 sugestões
        const suggestions = filtered.slice(0, 8).map(f => ({
            name: f.name,
            path: f.path,
            type: f.name.split('.').pop().toLowerCase()
        }));
        
        res.json({ success: true, suggestions });
    } catch (e) {
        console.error("Erro na busca de auto-sugestões:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// API para descobrir/detectar dispositivos locais (Roku, Shelly, Tasmota)
app.post('/api/home-control/discover', async (req, res) => {
    try {
        const discovered = await scanLocalSubnet();
        if (discovered && discovered.length > 0) {
            // Unir mantendo os manuais existentes
            const manuals = devices.filter(d => d.id.includes('.manual_') || d.protocol === 'custom');
            devices = [...manuals, ...discovered];
            saveDevices();
            return res.json({ success: true, count: discovered.length, devices });
        }
        res.json({ success: false, error: 'Nenhum dispositivo inteligente compatível (Roku TV, Shelly, Tasmota) foi detectado na sua rede local.' });
    } catch (e) {
        console.error("Erro na descoberta de dispositivos locais:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// API para adicionar dispositivo manualmente
app.post('/api/home-control/add', (req, res) => {
    const { name, type, ip, protocol, onUrl, offUrl, brightnessUrl, temperatureUrl } = req.body;
    
    if (!name || !type) {
        return res.status(400).json({ success: false, error: 'Nome e Tipo são obrigatórios.' });
    }
    
    const id = `${type}.manual_${Date.now()}`;
    const newDevice = {
        id,
        name,
        type,
        state: 'off',
        ip: ip || '',
        protocol: protocol || 'mock',
        onUrl: onUrl || '',
        offUrl: offUrl || '',
        brightnessUrl: brightnessUrl || '',
        temperatureUrl: temperatureUrl || '',
        brightness: 100,
        temperature: 22
    };
    
    devices.push(newDevice);
    saveDevices();
    res.json({ success: true, device: newDevice });
});

// API para excluir dispositivo
app.post('/api/home-control/delete', (req, res) => {
    const { deviceId } = req.body;
    const index = devices.findIndex(d => d.id === deviceId);
    
    if (index > -1) {
        devices.splice(index, 1);
        saveDevices();
        return res.json({ success: true });
    }
    res.status(404).json({ success: false, error: 'Dispositivo não encontrado.' });
});

// API para controlar dispositivos
app.post('/api/home-control/toggle', async (req, res) => {
    const { deviceId, state, brightness, temperature, volume, mediaAction } = req.body;
    const device = devices.find(d => d.id === deviceId);
    if (device) {
        if (state !== undefined) device.state = state;
        if (brightness !== undefined) device.brightness = parseInt(brightness);
        if (temperature !== undefined) device.temperature = parseInt(temperature);
        if (volume !== undefined) device.volume = parseInt(volume);
        if (mediaAction !== undefined) {
            if (mediaAction === 'play_pause') {
                device.mediaState = device.mediaState === 'playing' ? 'paused' : 'playing';
            }
        }
        saveDevices();

        // Controlar dispositivo real (local)
        try {
            await controlLocalDevice(device, { state, brightness, temperature, volume, mediaAction });
        } catch (err) {
            console.error(`Erro ao controlar dispositivo local (${deviceId}):`, err.message);
            return res.json({ success: true, device, warning: `Comando salvo localmente, mas falhou no aparelho real: ${err.message}` });
        }

        return res.json({ success: true, device });
    }
    res.status(404).json({ success: false, error: 'Dispositivo não encontrado' });
});

// Rotas de Tarefas (Kanban Board)
app.get('/tasks', (req, res) => {
    res.render('tasks', { config, tasksData });
});

app.post('/api/tasks/save', express.json(), (req, res) => {
    const { projects } = req.body;
    if (!projects) {
        return res.status(400).json({ success: false, error: 'Dados dos projetos inválidos.' });
    }
    
    // Update tasksData and write to file
    tasksData.projects = projects;
    saveTasks();
    res.json({ success: true, message: 'Tarefas salvas com sucesso.' });
});

function findCardById(taskId) {
    if (!tasksData || !tasksData.projects) return null;
    for (const projectId of Object.keys(tasksData.projects)) {
        const project = tasksData.projects[projectId];
        if (!project || !project.columns) continue;
        for (const columnId of Object.keys(project.columns)) {
            const column = project.columns[columnId];
            if (!column || !column.cards) continue;
            const card = column.cards.find(c => c.id === taskId);
            if (card) {
                return { card, project, column };
            }
        }
    }
    return null;
}

app.get('/tasks/edit/:taskId', (req, res) => {
    const { taskId } = req.params;
    const result = findCardById(taskId);
    if (!result) {
        return res.status(404).send('Tarefa não encontrada.');
    }
    const { card, project, column } = result;
    const successMsg = req.query.success === 'true' ? 'Tarefa salva com sucesso!' : null;
    res.render('task_edit', { config, card, project, column, successMsg });
});

app.post('/tasks/edit/:taskId', express.urlencoded({ extended: true }), (req, res) => {
    const { taskId } = req.params;
    const result = findCardById(taskId);
    if (!result) {
        return res.status(404).send('Tarefa não encontrada.');
    }
    
    const { card, project, column } = result;
    const title = (req.body.title || '').trim();
    const description = (req.body.description || '').trim();
    const category = (req.body.category || '').trim();
    const labelColor = req.body.labelColor || 'default';
    const dueDate = req.body.dueDate || '';
    const labelsRaw = (req.body.labels || '').trim();
    const targetColumnId = req.body.columnId || column.id;
    
    const labels = labelsRaw ? labelsRaw.split(',').map(l => l.trim()).filter(l => l !== '') : [];
    
    if (!title) {
        return res.status(400).send('O título da tarefa é obrigatório.');
    }
    
    // Update card properties
    card.title = title;
    card.description = description;
    card.category = category;
    card.labelColor = labelColor;
    card.dueDate = dueDate;
    card.labels = labels;
    card.mtime = new Date().toISOString();
    
    // Move column if status changed
    if (targetColumnId !== column.id) {
        const sourceCol = project.columns[column.id];
        const targetCol = project.columns[targetColumnId];
        if (sourceCol && targetCol) {
            // Remove from old column
            sourceCol.cards = sourceCol.cards.filter(c => c.id !== taskId);
            // Add to new column
            targetCol.cards.push(card);
        }
    }
    
    saveTasks();
    
    res.redirect(`/tasks/edit/${taskId}?success=true`);
});

function findCommentById(commentId) {
    if (!tasksData || !tasksData.projects) return null;
    for (const projectId of Object.keys(tasksData.projects)) {
        const project = tasksData.projects[projectId];
        if (!project || !project.columns) continue;
        for (const columnId of Object.keys(project.columns)) {
            const column = project.columns[columnId];
            if (!column || !column.cards) continue;
            for (const card of column.cards) {
                if (!card.comments) continue;
                const comment = card.comments.find(c => c.id === commentId);
                if (comment) {
                    return { comment, card, project, column };
                }
            }
        }
    }
    return null;
}

app.get('/tasks/comment/:commentId', (req, res) => {
    const { commentId } = req.params;
    const result = findCommentById(commentId);
    if (!result) {
        return res.status(404).send('Comentário não encontrado.');
    }
    const { comment, card, project, column } = result;
    const successMsg = req.query.success === 'true' ? 'Comentário salvo com sucesso!' : null;
    res.render('comment_edit', { config, comment, card, project, column, successMsg });
});

app.post('/tasks/comment/:commentId', express.urlencoded({ extended: true }), (req, res) => {
    const { commentId } = req.params;
    const result = findCommentById(commentId);
    if (!result) {
        return res.status(404).send('Comentário não encontrado.');
    }
    
    const { comment, card } = result;
    const text = (req.body.text || '').trim();
    const attachmentsJson = req.body.attachmentsJson || '[]';
    
    if (!text) {
        return res.status(400).send('O texto do comentário é obrigatório.');
    }
    
    let attachments = [];
    try {
        attachments = JSON.parse(attachmentsJson);
    } catch (e) {
        console.error("Erro ao fazer parse dos anexos do comentário:", e);
    }
    
    comment.text = text;
    comment.attachments = attachments;
    comment.mtime = new Date().toISOString();
    
    saveTasks();
    
    res.redirect(`/tasks/comment/${commentId}?success=true`);
});

app.get('/api/tasks/backup/export', (req, res) => {
    try {
        const zip = new AdmZip();
        
        // 1. Add tasks.json
        const tasksFile = path.join(DATACACHE_DIR, 'tasks.json');
        if (fs.existsSync(tasksFile)) {
            zip.addLocalFile(tasksFile, '', 'tasks.json');
        }
        
        // 2. Add tasks attachments directories
        const sharedPath = path.join(__dirname, SHARED_DIR);
        if (fs.existsSync(sharedPath)) {
            const walk = (dir) => {
                const list = fs.readdirSync(dir);
                list.forEach(file => {
                    const filePath = path.join(dir, file);
                    const stat = fs.statSync(filePath);
                    if (stat.isDirectory()) {
                        if (file === 'tasks') {
                            const relPath = path.relative(sharedPath, filePath);
                            zip.addLocalFolder(filePath, 'shared/' + relPath.replace(/\\/g, '/'));
                        } else {
                            walk(filePath);
                        }
                    }
                });
            };
            walk(sharedPath);
        }
        
        const zipBuffer = zip.toBuffer();
        
        // Salva cópia localmente na pasta de backups (dumps)
        const filename = `backup-kanban-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
        const localPath = path.join(BACKUPS_DIR, filename);
        fs.writeFileSync(localPath, zipBuffer);
        
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename=blackbird-kanban-backup.zip');
        res.send(zipBuffer);
    } catch (err) {
        console.error("Erro ao exportar backup do Kanban:", err);
        res.status(500).send("Erro ao gerar backup: " + err.message);
    }
});

const importUpload = multer({ dest: path.join(__dirname, 'datacache') });

app.post('/api/tasks/backup/import', importUpload.single('backupFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('Nenhum arquivo enviado.');
    }
    
    const zipPath = req.file.path;
    const extractTempDir = path.join(__dirname, SHARED_DIR, 'temp_backup_extract');
    
    try {
        const zip = new AdmZip(zipPath);
        
        await fs.emptyDir(extractTempDir);
        zip.extractAllTo(extractTempDir, true);
        
        // 1. Verify tasks.json exists
        const extractedTasksJson = path.join(extractTempDir, 'tasks.json');
        if (!fs.existsSync(extractedTasksJson)) {
            await fs.remove(extractTempDir);
            await fs.remove(zipPath);
            return res.status(400).send('Arquivo de backup inválido: tasks.json não encontrado.');
        }
        
        // 2. Overwrite tasks.json in datacache
        const tasksFile = path.join(DATACACHE_DIR, 'tasks.json');
        await fs.copy(extractedTasksJson, tasksFile);
        
        // 3. Copy shared/ folder if exists
        const extractedShared = path.join(extractTempDir, 'shared');
        if (fs.existsSync(extractedShared)) {
            const destShared = path.join(__dirname, SHARED_DIR);
            await fs.copy(extractedShared, destShared);
        }
        
        // 4. Reload tasksData in memory
        tasksData = await fs.readJson(tasksFile);
        
        await fs.remove(extractTempDir);
        await fs.remove(zipPath);
        
        res.redirect('/settings?success=true&backupImported=true');
    } catch (err) {
        console.error("Erro ao importar backup do Kanban:", err);
        try {
            await fs.remove(extractTempDir);
            await fs.remove(zipPath);
        } catch(e){}
        res.status(500).send("Erro ao importar backup: " + err.message);
    }
});

// Rotas de Configurações do Sistema
app.get('/settings', (req, res) => {
    const successMsg = req.query.success === 'true' ? 'Configurações salvas com sucesso!' : null;
    
    let localBackups = [];
    try {
        if (fs.existsSync(BACKUPS_DIR)) {
            const files = fs.readdirSync(BACKUPS_DIR);
            localBackups = files.map(file => {
                const filePath = path.join(BACKUPS_DIR, file);
                const stat = fs.statSync(filePath);
                return {
                    name: file,
                    size: stat.size,
                    createdAt: stat.birthtime
                };
            }).sort((a, b) => b.createdAt - a.createdAt);
        }
    } catch (e) {
        console.error("Erro ao carregar backups locais:", e);
    }
    
    res.render('settings', { config, successMsg, localBackups });
});

app.get('/api/backups/download/:filename', (req, res) => {
    const filePath = path.join(BACKUPS_DIR, req.params.filename);
    if (fs.existsSync(filePath)) {
        res.download(filePath);
    } else {
        res.status(404).send('Arquivo não encontrado');
    }
});

app.post('/api/backups/restore/:filename', async (req, res) => {
    const filePath = path.join(BACKUPS_DIR, req.params.filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, error: 'Arquivo de backup não encontrado' });
    }
    
    const isZip = req.params.filename.toLowerCase().endsWith('.zip');
    
    try {
        if (isZip) {
            const zip = new AdmZip(filePath);
            const extractTempDir = path.join(__dirname, SHARED_DIR, 'temp_backup_extract');
            
            await fs.emptyDir(extractTempDir);
            zip.extractAllTo(extractTempDir, true);
            
            // Restaura configurações se existirem no backup
            const extractedConfig = path.join(extractTempDir, 'backup_data.json');
            if (fs.existsSync(extractedConfig)) {
                const backup = fs.readJsonSync(extractedConfig);
                if (backup && backup.version === "1.0" && backup.data) {
                    const data = backup.data;
                    if (data.cameras) fs.writeJsonSync(CAMERAS_FILE, data.cameras, { spaces: 2 });
                    if (data.favorites) fs.writeJsonSync(FAVORITES_FILE, data.favorites, { spaces: 2 });
                    if (data.history) fs.writeJsonSync(HISTORY_FILE, data.history, { spaces: 2 });
                    if (data.hidden_files) fs.writeJsonSync(HIDDEN_FILES_FILE, data.hidden_files, { spaces: 2 });
                    if (data.password) {
                        fs.writeJsonSync(PASSWORD_FILE, data.password, { spaces: 2 });
                        if (data.password.password) hiddenPassword = data.password.password;
                    }
                    if (data.config) {
                        fs.writeJsonSync(CONFIG_FILE, data.config, { spaces: 2 });
                        config = { ...config, ...data.config };
                    }
                }
            }
            
            // Restaura banco de dados de tarefas se existir
            const extractedTasksJson = path.join(extractTempDir, 'tasks.json');
            if (fs.existsSync(extractedTasksJson)) {
                const tasksFile = path.join(DATACACHE_DIR, 'tasks.json');
                await fs.copy(extractedTasksJson, tasksFile);
                tasksData = await fs.readJson(tasksFile);
            }
            
            // Restaura arquivos de mídia anexados se existirem
            const extractedShared = path.join(extractTempDir, 'shared');
            if (fs.existsSync(extractedShared)) {
                const destShared = path.join(__dirname, SHARED_DIR);
                await fs.copy(extractedShared, destShared);
            }
            
            await fs.remove(extractTempDir);
        } else {
            // Importação clássica de arquivo JSON
            const backup = fs.readJsonSync(filePath);
            if (!backup || backup.version !== "1.0" || !backup.data) {
                return res.status(400).json({ success: false, error: 'Formato de backup inválido.' });
            }

            const data = backup.data;
            if (data.cameras) fs.writeJsonSync(CAMERAS_FILE, data.cameras, { spaces: 2 });
            if (data.favorites) fs.writeJsonSync(FAVORITES_FILE, data.favorites, { spaces: 2 });
            if (data.history) fs.writeJsonSync(HISTORY_FILE, data.history, { spaces: 2 });
            if (data.hidden_files) fs.writeJsonSync(HIDDEN_FILES_FILE, data.hidden_files, { spaces: 2 });
            if (data.password) {
                fs.writeJsonSync(PASSWORD_FILE, data.password, { spaces: 2 });
                if (data.password.password) hiddenPassword = data.password.password;
            }
            if (data.config) {
                fs.writeJsonSync(CONFIG_FILE, data.config, { spaces: 2 });
                config = { ...config, ...data.config };
            }
        }
        
        res.json({ success: true });
    } catch (e) {
        console.error("Erro ao restaurar backup local:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

app.delete('/api/backups/:filename', async (req, res) => {
    const filePath = path.join(BACKUPS_DIR, req.params.filename);
    try {
        if (fs.existsSync(filePath)) {
            await fs.remove(filePath);
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false, error: 'Arquivo não encontrado' });
        }
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/settings/save', express.urlencoded({ extended: true }), (req, res) => {
    const authEnabled = req.body.authEnabled === 'true';
    const loginPassword = req.body.loginPassword || 'admin';
    const allowedExtensions = req.body.allowedExtensions || '';
    const language = req.body.language || 'en';
    const appAddress = req.body.appAddress || '';
    const layoutFullWidth = req.body.layoutFullWidth === 'true';
    const theme = req.body.theme || 'default';
    
    // Hugging Face config
    const hfToken = req.body.hfToken || '';

    // Agent config
    const agentName = req.body.agentName || 'Assistente Inteligente';
    const agentModel = req.body.agentModel || 'meta-llama/Llama-3.1-8B-Instruct';
    const agentRagDir = req.body.agentRagDir || 'public/shared';
    const agentTemperature = !isNaN(parseFloat(req.body.agentTemperature)) ? parseFloat(req.body.agentTemperature) : 0.7;
    const agentSkills = req.body.agentSkills || '';

    // Scheduler config
    const schedulerInterval = parseInt(req.body.schedulerInterval, 10) || 10;
    const schedulerCheckFeatures = req.body.schedulerCheckFeatures === 'true';
    const schedulerCheckTasks = req.body.schedulerCheckTasks === 'true';
    const schedulerCheckReminders = req.body.schedulerCheckReminders === 'true';
    const limitAlertsOncePerDay = req.body.limitAlertsOncePerDay === 'true';

    config.authEnabled = authEnabled;
    config.loginPassword = loginPassword;
    config.allowedExtensions = allowedExtensions;
    config.language = language;
    let cleanAddress = appAddress.trim().replace(/\/$/, '');
    if (cleanAddress && !/^https?:\/\//i.test(cleanAddress)) {
        cleanAddress = 'http://' + cleanAddress;
    }
    config.appAddress = cleanAddress;
    config.layoutFullWidth = layoutFullWidth;
    config.theme = theme;
    
    config.hfToken = hfToken;

    // Configurações do Agente de AI
    config.agentName = agentName;
    config.agentModel = agentModel;
    config.agentRagDir = agentRagDir;
    config.agentTemperature = agentTemperature;
    config.agentSkills = agentSkills;

    // Configurações do Scheduler
    config.schedulerInterval = schedulerInterval;
    config.schedulerCheckFeatures = schedulerCheckFeatures;
    config.schedulerCheckTasks = schedulerCheckTasks;
    config.schedulerCheckReminders = schedulerCheckReminders;
    config.limitAlertsOncePerDay = limitAlertsOncePerDay;

    // Telegram Bot config
    config.telegramBotEnabled = req.body.telegramBotEnabled === 'true' || req.body.telegramBotEnabled === 'on' || req.body.telegramBotEnabled === true;
    config.telegramBotToken = req.body.telegramBotToken || '';
    config.telegramAllowedUsers = req.body.telegramAllowedUsers || '';

    // Sincronizar a senha da área oculta com a senha de login configurada
    hiddenPassword = loginPassword;

    try {
        fs.writeJsonSync(CONFIG_FILE, config, { spaces: 2 });
        fs.writeJsonSync(PASSWORD_FILE, { password: hiddenPassword }, { spaces: 2 });
        
        // Sincronizar o polling do Telegram com as novas chaves
        syncTelegramBot();

        if (!authEnabled) {
            res.clearCookie('authenticated', { path: '/' });
        }
        res.redirect('/settings?success=true');
    } catch (e) {
        console.error("Erro ao salvar config.json:", e);
        res.status(500).send("Erro interno ao salvar as configurações.");
    }
});

// ==================== APP: LOCALIZATION & TRACKING ====================
app.get('/localization', authMiddleware, (req, res) => {
    const cookies = getCookies(req);
    const username = cookies.username || 'guest';

    // Carregar percurso do usuário logado
    const userLocFile = path.join(__dirname, SHARED_DIR, 'users', username, 'localizations.json');
    let userLocData = { isPublic: false, path: [] };
    if (fs.existsSync(userLocFile)) {
        try {
            userLocData = fs.readJsonSync(userLocFile);
        } catch (e) {
            console.error(`Erro ao ler localizations.json para ${username}:`, e);
        }
    }

    // Carregar percursos públicos de outros usuários
    let publicUsers = {};
    try {
        users.forEach(u => {
            if (u.username !== username) {
                const uLocFile = path.join(__dirname, SHARED_DIR, 'users', u.username, 'localizations.json');
                if (fs.existsSync(uLocFile)) {
                    try {
                        const uData = fs.readJsonSync(uLocFile);
                        if (uData && uData.isPublic) {
                            publicUsers[u.username] = {
                                path: uData.path || []
                            };
                        }
                    } catch (e) {
                        console.error(`Erro ao ler localizations.json de ${u.username}:`, e);
                    }
                }
            }
        });
    } catch (err) {
        console.error("Erro ao processar percursos de outros usuários:", err);
    }

    res.render('localization', {
        currentUser: username,
        userCoordinates: userLocData.path || [],
        isPublic: userLocData.isPublic || false,
        publicUsers: publicUsers,
        config
    });
});

app.post('/api/localization/update', authMiddleware, express.json(), (req, res) => {
    const cookies = getCookies(req);
    const username = cookies.username;

    if (!username) {
        return res.status(401).json({ success: false, error: 'Usuário não autenticado.' });
    }

    const { lat, lng } = req.body;
    if (lat === undefined || lng === undefined) {
        return res.status(400).json({ success: false, error: 'Coordenadas inválidas.' });
    }

    const userLocFile = path.join(__dirname, SHARED_DIR, 'users', username, 'localizations.json');
    let userLocData = { isPublic: false, path: [] };
    
    // Garantir que a pasta do usuário exista
    const userDir = path.dirname(userLocFile);
    fs.ensureDirSync(userDir);

    if (fs.existsSync(userLocFile)) {
        try {
            userLocData = fs.readJsonSync(userLocFile);
        } catch (e) {
            console.error(`Erro ao ler localizations.json para ${username}:`, e);
        }
    }

    // Adicionar a nova coordenada com data e hora no início da lista (mais recente primeiro)
    const now = new Date();
    const timeStr = now.toLocaleDateString('pt-BR') + ' ' + now.toLocaleTimeString('pt-BR');
    
    // Inicializar path se não existir
    if (!userLocData.path) userLocData.path = [];
    
    userLocData.path.unshift({
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        time: timeStr,
        timestamp: now.toISOString()
    });

    // Limitar o histórico aos últimos 100 registros para evitar arquivos gigantes
    if (userLocData.path.length > 100) {
        userLocData.path = userLocData.path.slice(0, 100);
    }

    try {
        fs.writeJsonSync(userLocFile, userLocData, { spaces: 2 });
        res.json({ success: true, path: userLocData.path });
    } catch (e) {
        console.error(`Erro ao salvar localizations.json para ${username}:`, e);
        res.status(500).json({ success: false, error: 'Erro ao gravar arquivo de localização.' });
    }
});

app.post('/api/localization/public-toggle', authMiddleware, express.json(), (req, res) => {
    const cookies = getCookies(req);
    const username = cookies.username;

    if (!username) {
        return res.status(401).json({ success: false, error: 'Usuário não autenticado.' });
    }

    const { isPublic } = req.body;
    const userLocFile = path.join(__dirname, SHARED_DIR, 'users', username, 'localizations.json');
    let userLocData = { isPublic: false, path: [] };

    // Garantir que a pasta do usuário exista
    const userDir = path.dirname(userLocFile);
    fs.ensureDirSync(userDir);

    if (fs.existsSync(userLocFile)) {
        try {
            userLocData = fs.readJsonSync(userLocFile);
        } catch (e) {
            console.error(`Erro ao ler localizations.json para ${username}:`, e);
        }
    }

    userLocData.isPublic = !!isPublic;

    try {
        fs.writeJsonSync(userLocFile, userLocData, { spaces: 2 });
        res.json({ success: true });
    } catch (e) {
        console.error(`Erro ao salvar localizations.json para ${username}:`, e);
        res.status(500).json({ success: false, error: 'Erro ao gravar arquivo de localização.' });
    }
});

// Rota de Exportação de Configurações e Setup de Arquivos
app.get('/settings/export', (req, res) => {
    try {
        const includeConfig = req.query.includeConfig === 'true';
        const includeKanban = req.query.includeKanban === 'true';
        const includeAssets = req.query.includeAssets === 'true';
        
        // Se nenhum parâmetro for fornecido (link direto antigo), retorna o formato de backup JSON legado
        if (!req.query.hasOwnProperty('includeConfig') && !req.query.hasOwnProperty('includeKanban') && !req.query.hasOwnProperty('includeAssets')) {
            const cameras = fs.readJsonSync(CAMERAS_FILE, { throws: false }) || [];
            const favorites = fs.readJsonSync(FAVORITES_FILE, { throws: false }) || [];
            const history = fs.readJsonSync(HISTORY_FILE, { throws: false }) || [];
            const hidden_files = fs.readJsonSync(HIDDEN_FILES_FILE, { throws: false }) || [];
            const password = fs.readJsonSync(PASSWORD_FILE, { throws: false }) || {};
            const configuration = fs.readJsonSync(CONFIG_FILE, { throws: false }) || {};

            const backup = {
                version: "1.0",
                exportedAt: new Date().toISOString(),
                data: {
                    cameras,
                    favorites,
                    history,
                    hidden_files,
                    password,
                    config: configuration
                }
            };

            const backupFilename = `backup-legacy-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
            const localBackupPath = path.join(BACKUPS_DIR, backupFilename);
            fs.writeJsonSync(localBackupPath, backup, { spaces: 2 });

            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', 'attachment; filename=blackbird_backup.json');
            return res.send(JSON.stringify(backup, null, 2));
        }
        
        // Criação de Backup Customizado ZIP
        const zip = new AdmZip();
        
        if (includeConfig) {
            const cameras = fs.readJsonSync(CAMERAS_FILE, { throws: false }) || [];
            const favorites = fs.readJsonSync(FAVORITES_FILE, { throws: false }) || [];
            const history = fs.readJsonSync(HISTORY_FILE, { throws: false }) || [];
            const hidden_files = fs.readJsonSync(HIDDEN_FILES_FILE, { throws: false }) || [];
            const password = fs.readJsonSync(PASSWORD_FILE, { throws: false }) || {};
            const configuration = fs.readJsonSync(CONFIG_FILE, { throws: false }) || {};

            const backup = {
                version: "1.0",
                exportedAt: new Date().toISOString(),
                data: {
                    cameras,
                    favorites,
                    history,
                    hidden_files,
                    password,
                    config: configuration
                }
            };
            zip.addFile('backup_data.json', Buffer.from(JSON.stringify(backup, null, 2)), 'Configurações do Servidor');
        }
        
        if (includeKanban) {
            const tasksFile = path.join(DATACACHE_DIR, 'tasks.json');
            if (fs.existsSync(tasksFile)) {
                zip.addLocalFile(tasksFile, '', 'tasks.json');
            }
        }
        
        if (includeAssets) {
            const sharedPath = path.join(__dirname, SHARED_DIR);
            if (fs.existsSync(sharedPath)) {
                const walk = (dir) => {
                    const list = fs.readdirSync(dir);
                    list.forEach(file => {
                        const filePath = path.join(dir, file);
                        const stat = fs.statSync(filePath);
                        if (stat.isDirectory()) {
                            if (file === 'tasks') {
                                const relPath = path.relative(sharedPath, filePath);
                                zip.addLocalFolder(filePath, 'shared/' + relPath.replace(/\\/g, '/'));
                            } else {
                                walk(filePath);
                            }
                        }
                    });
                };
                walk(sharedPath);
            }
        }
        
        const zipBuffer = zip.toBuffer();
        
        // Salva cópia localmente na pasta de backups (dumps)
        const backupFilename = `backup-custom-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
        const localBackupPath = path.join(BACKUPS_DIR, backupFilename);
        fs.writeFileSync(localBackupPath, zipBuffer);
        
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename=blackbird-backup.zip');
        res.send(zipBuffer);
    } catch (e) {
        console.error("Erro ao exportar configurações/Kanban:", e);
        res.status(500).send("Erro ao gerar arquivo de exportação.");
    }
});

// Rota de Importação de Configurações e Setup de Arquivos
app.post('/settings/import', importUpload.single('backupFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send("Nenhum arquivo de backup enviado.");
    }

    const tempFilePath = req.file.path;
    const isZip = req.file.originalname.toLowerCase().endsWith('.zip');
    
    try {
        if (isZip) {
            const zip = new AdmZip(tempFilePath);
            const extractTempDir = path.join(__dirname, SHARED_DIR, 'temp_backup_extract');
            
            await fs.emptyDir(extractTempDir);
            zip.extractAllTo(extractTempDir, true);
            
            // Restaura configurações se existirem no backup
            const extractedConfig = path.join(extractTempDir, 'backup_data.json');
            if (fs.existsSync(extractedConfig)) {
                const backup = fs.readJsonSync(extractedConfig);
                if (backup && backup.version === "1.0" && backup.data) {
                    const data = backup.data;
                    if (data.cameras) fs.writeJsonSync(CAMERAS_FILE, data.cameras, { spaces: 2 });
                    if (data.favorites) fs.writeJsonSync(FAVORITES_FILE, data.favorites, { spaces: 2 });
                    if (data.history) fs.writeJsonSync(HISTORY_FILE, data.history, { spaces: 2 });
                    if (data.hidden_files) fs.writeJsonSync(HIDDEN_FILES_FILE, data.hidden_files, { spaces: 2 });
                    if (data.password) {
                        fs.writeJsonSync(PASSWORD_FILE, data.password, { spaces: 2 });
                        if (data.password.password) hiddenPassword = data.password.password;
                    }
                    if (data.config) {
                        fs.writeJsonSync(CONFIG_FILE, data.config, { spaces: 2 });
                        config = { ...config, ...data.config };
                    }
                }
            }
            
            // Restaura banco de dados de tarefas se existir
            const extractedTasksJson = path.join(extractTempDir, 'tasks.json');
            if (fs.existsSync(extractedTasksJson)) {
                const tasksFile = path.join(DATACACHE_DIR, 'tasks.json');
                await fs.copy(extractedTasksJson, tasksFile);
                tasksData = await fs.readJson(tasksFile);
            }
            
            // Restaura arquivos de mídia anexados se existirem
            const extractedShared = path.join(extractTempDir, 'shared');
            if (fs.existsSync(extractedShared)) {
                const destShared = path.join(__dirname, SHARED_DIR);
                await fs.copy(extractedShared, destShared);
            }
            
            await fs.remove(extractTempDir);
        } else {
            // Importação clássica de arquivo JSON
            const backup = fs.readJsonSync(tempFilePath);
            if (!backup || backup.version !== "1.0" || !backup.data) {
                fs.removeSync(tempFilePath);
                return res.status(400).send("Formato de backup inválido.");
            }

            const data = backup.data;
            if (data.cameras) fs.writeJsonSync(CAMERAS_FILE, data.cameras, { spaces: 2 });
            if (data.favorites) fs.writeJsonSync(FAVORITES_FILE, data.favorites, { spaces: 2 });
            if (data.history) fs.writeJsonSync(HISTORY_FILE, data.history, { spaces: 2 });
            if (data.hidden_files) fs.writeJsonSync(HIDDEN_FILES_FILE, data.hidden_files, { spaces: 2 });
            if (data.password) {
                fs.writeJsonSync(PASSWORD_FILE, data.password, { spaces: 2 });
                if (data.password.password) hiddenPassword = data.password.password;
            }
            if (data.config) {
                fs.writeJsonSync(CONFIG_FILE, data.config, { spaces: 2 });
                config = { ...config, ...data.config };
            }
        }

        fs.removeSync(tempFilePath);
        
        const redirectTo = req.headers.referer && req.headers.referer.includes('/tasks') ? '/tasks?success=true&backupImported=true' : '/settings?success=true&backupImported=true';
        res.redirect(redirectTo);
    } catch (e) {
        console.error("Erro ao importar backup:", e);
        if (fs.existsSync(tempFilePath)) {
            fs.removeSync(tempFilePath);
        }
        res.status(500).send("Erro ao importar backup: " + e.message);
    }
});

// Função para limpar arquivos temporários (.tmp) residuais na inicialização
function cleanupTempFiles(dir) {
    if (!fs.existsSync(dir)) return;
    try {
        const list = fs.readdirSync(dir, { withFileTypes: true });
        list.forEach(item => {
            const fullPath = path.join(dir, item.name);
            if (item.isDirectory()) {
                if (item.name !== 'temp' && item.name !== 'optimized') {
                    cleanupTempFiles(fullPath);
                }
            } else if (item.isFile() && item.name.endsWith('.tmp')) {
                try {
                    fs.removeSync(fullPath);
                    console.log(`Arquivo temporário residual removido na inicialização: ${item.name}`);
                } catch (err) {
                    console.error(`Falha ao remover arquivo temporário residual ${item.name}:`, err.message);
                }
            }
        });
    } catch (e) {
        console.error("Erro ao listar diretório para limpeza de temporários:", e.message);
    }
}

const sharedPath = path.join(__dirname, SHARED_DIR);
cleanupTempFiles(sharedPath);

const WebSocket = require('ws');

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
    ws.id = crypto.randomBytes(8).toString('hex');
    ws.role = 'unknown';
    ws.authorized = false;
    ws.playerId = null;
    ws.pairId = null;

    // Parse user cookies from WebSocket upgrade request headers
    const cookies = getCookies(req);
    ws.username = cookies.username || '';
    ws.userGroup = cookies.userGroup || 'customer';

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'register') {
                ws.role = data.role;
                ws.userAgent = data.userAgent || 'Celular';
                
                if (ws.role === 'player') {
                    ws.playerId = data.playerId;
                    console.log(`Player registrado (ID: ${ws.id}, PlayerSessionId: ${ws.playerId}, User: ${ws.username})`);
                } else if (ws.role === 'remote') {
                    ws.pairId = data.pairId;
                    console.log(`Remote registrado (ID: ${ws.id}, PairTargetId: ${ws.pairId}, User: ${ws.username})`);

                    // Solicitar pareamento APENAS aos players desktop ativos com o mesmo playerId
                    let playersCount = 0;
                    wss.clients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN && client.role === 'player' && client.playerId === ws.pairId) {
                            playersCount++;
                            client.send(JSON.stringify({
                                type: 'auth_request',
                                remoteId: ws.id,
                                userAgent: ws.userAgent
                            }));
                        }
                    });

                    if (playersCount === 0) {
                        console.log(`Tentativa de pareamento falhou: nenhum player correspondente com ID ${ws.pairId}`);
                        ws.send(JSON.stringify({ type: 'auth_result', authorized: false }));
                        ws.close();
                    }
                }
            } else if (data.type === 'auth_response') {
                if (ws.role === 'player') {
                    console.log(`Resposta de pareamento para o remote ${data.remoteId}: ${data.allowed}`);
                    wss.clients.forEach((client) => {
                        if (client.id === data.remoteId && client.role === 'remote') {
                            client.authorized = data.allowed;
                            if (data.allowed) {
                                client.pairId = ws.playerId;
                            }
                            client.send(JSON.stringify({ type: 'auth_result', authorized: data.allowed }));
                            if (!data.allowed) {
                                client.close();
                            }
                        }
                    });
                }
            } else if (data.type === 'input_focus' || data.type === 'input_blur') {
                if (ws.role === 'player') {
                    // Envia foco apenas para remotes pareados com este player específico
                    wss.clients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN && client.role === 'remote' && client.authorized && client.pairId === ws.playerId) {
                            client.send(JSON.stringify(data));
                        }
                    });
                }
            } else if (data.type === 'command') {
                if (ws.role === 'remote' && ws.authorized) {
                    console.log(`Comando recebido de controle autorizado (${ws.id}) para player ${ws.pairId}: ${data.action}`);
                    // Envia comando apenas para os players pareados correspondentes
                    wss.clients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN && client.role === 'player' && client.playerId === ws.pairId) {
                            client.send(JSON.stringify(data));
                        }
                    });
                }
            }
        } catch (e) {
            console.error("Erro ao processar mensagem websocket:", e);
        }
    });
});

// Rotinas de Validação em Segundo Plano (Scheduler)
function runSchedulerValidation() {
    console.log("[Scheduler] Iniciando validação de rotinas em segundo plano...");
    
    // 1. Validar Integridade de Features
    if (config.schedulerCheckFeatures) {
        const requiredDirs = ['public/shared', 'datacache', 'views', 'public/music', 'public/video'];
        requiredDirs.forEach(dir => {
            const fullPath = path.join(__dirname, dir);
            if (!fs.existsSync(fullPath)) {
                try {
                    fs.ensureDirSync(fullPath);
                    console.log(`[Scheduler] Pasta restaurada: ${dir}`);
                } catch (e) {
                    console.error(`[Scheduler] Erro ao restaurar pasta ${dir}:`, e);
                }
            }
        });
    }
    
    // 2. Validar Tarefas e Lembretes
    if (config.schedulerCheckTasks || config.schedulerCheckReminders) {
        const tasksFile = path.join(DATACACHE_DIR, 'tasks.json');
        if (fs.existsSync(tasksFile)) {
            try {
                const data = fs.readJsonSync(tasksFile);
                if (data && data.projects) {
                    const today = new Date();
                    today.setHours(0,0,0,0);
                    let overdueTasks = [];
                    let pendingTasks = [];
                    
                    Object.keys(data.projects).forEach(projId => {
                        const proj = data.projects[projId];
                        const cols = proj.columns || {};
                        
                        Object.keys(cols).forEach(colId => {
                            if (colId === 'done') return;
                            const cards = cols[colId].cards || [];
                            cards.forEach(card => {
                                if (card.dueDate) {
                                    const dueDate = new Date(card.dueDate + 'T00:00:00');
                                    if (dueDate < today) {
                                        const diffTime = Math.abs(today - dueDate);
                                        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                                        overdueTasks.push({ title: card.title, id: card.id, project: proj.name, dueDate: card.dueDate, overdueDays: diffDays });
                                    } else {
                                        const diffTime = Math.abs(dueDate - today);
                                        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                                        if (diffDays <= 3) {
                                            pendingTasks.push({ title: card.title, id: card.id, project: proj.name, dueDate: card.dueDate });
                                        }
                                    }
                                }
                            });
                        });
                    });
                    
                    let notificationAdded = false;
                    const todayStr = new Date().toISOString().split('T')[0];

                    if (config.schedulerCheckTasks && overdueTasks.length > 0) {
                        overdueTasks.forEach(task => {
                            const notifMsg = `A tarefa **${task.title}** (ID: \`${task.id}\` no projeto "${task.project}") está atrasada há ${task.overdueDays} dia(s)! Data limite era: ${task.dueDate}. Por favor, verifique no quadro de tarefas.`;
                            const hasNotifiedToday = notifications.some(n => 
                                n.message.includes(task.id) && 
                                n.timestamp.startsWith(todayStr)
                            );
                            if (!hasNotifiedToday) {
                                notifications.unshift({
                                    id: 'notif_' + Math.random().toString(36).substring(2, 9),
                                    title: '⚠️ scheduler: Tarefa Atrasada',
                                    message: notifMsg,
                                    type: 'alert',
                                    timestamp: new Date().toISOString(),
                                    read: false
                                });
                                notificationAdded = true;
                                broadcastTelegramMessage(`⚠️ *Tarefa Atrasada*\n\n${notifMsg}`);
                            }
                        });
                    }
                    
                    if (config.schedulerCheckReminders && pendingTasks.length > 0) {
                        pendingTasks.forEach(task => {
                            const notifMsg = `Lembrete: A tarefa **${task.title}** (ID: \`${task.id}\` no projeto "${task.project}") está próxima do vencimento (${task.dueDate}).`;
                            const hasNotifiedToday = notifications.some(n => 
                                n.message.includes(task.id) && 
                                n.timestamp.startsWith(todayStr)
                            );
                            if (!hasNotifiedToday) {
                                notifications.unshift({
                                    id: 'notif_' + Math.random().toString(36).substring(2, 9),
                                    title: '📅 scheduler: Lembrete de Tarefa',
                                    message: notifMsg,
                                    type: 'info',
                                    timestamp: new Date().toISOString(),
                                    read: false
                                });
                                notificationAdded = true;
                                broadcastTelegramMessage(`📅 *Lembrete de Tarefa*\n\n${notifMsg}`);
                            }
                        });
                    }
                    
                    if (notificationAdded) {
                        saveNotifications();
                    }
                }
            } catch (e) {
                console.error("[Scheduler] Erro ao processar tasks para validação:", e);
            }
        }
    }
}

// Rotinas Proativas de Agentes (Scheduler)
async function runProactiveAgentsCheck() {
    console.log("[Scheduler] Iniciando verificação de agentes proativos...");
    
    if (config.limitAlertsOncePerDay) {
        const todayStr = new Date().toISOString().split('T')[0];
        const alreadyNotifiedToday = notifications.some(n => 
            (n.title.includes('Proactive message') || n.title.includes('scheduler:') || n.title.includes('Alerta') || n.title.includes('Lembrete')) && 
            n.timestamp.startsWith(todayStr)
        );
        if (alreadyNotifiedToday) {
            console.log("[Scheduler] Verificação proativa de agentes ignorada hoje para economizar tokens (limite de 1x/dia ativo).");
            return;
        }
    }

    const proactiveAgents = agentsList.filter(a => a.isProactive);
    if (proactiveAgents.length === 0) {
        console.log("[Scheduler] Nenhum agente proativo cadastrado.");
        return;
    }

    // Para evitar flooding, selecionamos um agente proativo aleatório por rodada
    const agent = proactiveAgents[Math.floor(Math.random() * proactiveAgents.length)];
    console.log(`[Scheduler] Agente selecionado para interação proativa: ${agent.name}`);
    
    // Obter contexto de tarefas
    let tasksContext = '';
    try {
        const tasksFile = path.join(DATACACHE_DIR, 'tasks.json');
        if (fs.existsSync(tasksFile)) {
            const data = fs.readJsonSync(tasksFile);
            if (data && data.projects) {
                Object.keys(data.projects).forEach(pId => {
                    const proj = data.projects[pId];
                    tasksContext += `Projeto: ${proj.name}\n`;
                    Object.keys(proj.columns).forEach(colKey => {
                        const col = proj.columns[colKey];
                        if (col.cards && col.cards.length > 0) {
                            col.cards.forEach(card => {
                                tasksContext += ` - [ID: ${card.id}] ${card.title} (Status/Coluna: ${col.title})\n`;
                            });
                        }
                    });
                });
            }
        }
    } catch(e) {
        console.error("Erro ao carregar contexto de tarefas para agente proativo:", e);
    }

    const systemPrompt = `Você é o ${agent.name}, com o perfil de "${agent.profile}" e habilidades: "${agent.skills}".
Esta é uma rotina proativa automática onde você envia uma mensagem curta, amigável e direta ao usuário.
Baseado no seu perfil profissional e opcionalmente nas tarefas atuais:
${tasksContext ? `- Lista de Tarefas Atuais:\n${tasksContext}` : ''}

IMPORTANTE:
- Ao citar ou se referir a qualquer tarefa, você deve obrigatoriamente mencionar o Nome do Projeto e o Título da Tarefa de forma amigável e clara para um humano (por exemplo: "a tarefa 'Estudar Arquitetura' do projeto 'Media Center'"). NUNCA cite IDs genéricos como "task_3" ou "card_xxx" diretamente no texto para o usuário.
- Se houver mais de uma tarefa pendente ou atrasada, você deve listar todas de forma numerada (1 a X), incluindo o Título da Tarefa e a Data de Vencimento (Due Date) legível (ex: "1. Estudar Arquitetura (Vence em: 2026-07-20)").
- Se você for um personal trainer ou perfil de saúde/esporte, pergunte como foi o treino, se está tudo certo para o treino de hoje ou se o usuário executou as atividades físicas.
- Se for um desenvolvedor ou assistente de tarefas, pergunte sobre o andamento de alguma atividade ou informe sobre tarefas atrasadas/pendentes de forma humanizada.
- Crie uma mensagem curta (máximo 3-4 frases).
- NUNCA, SOB NENHUMA HIPÓTESE, INCLUA BLOCOS DE CÓDIGO JSON OU COMANDOS JSON (como {"action": ...}) nesta mensagem. A mensagem deve ser puramente textual, amigável e limpa para leitura.`;

    const hfToken = config.hfToken || process.env.HF_TOKEN || "";
    const agentModel = agent.model || config.agentModel || "meta-llama/Llama-3.1-8B-Instruct";
    const agentTemp = agent.temperature !== undefined ? agent.temperature : 0.7;

    try {
        const response = await fetch(`https://router.huggingface.co/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${hfToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: agentModel,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: "Por favor, envie sua mensagem proativa de acompanhamento diário. ATENÇÃO: Se houver mais de uma tarefa pendente/atrasada, liste-as obrigatoriamente de forma numerada com Título e Data de Vencimento. NUNCA gere blocos de código JSON ou comandos estruturados." }
                ],
                temperature: agentTemp,
                max_tokens: 250
            })
        });

        if (response.ok) {
            const data = await response.json();
            const reply = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : null;
            if (reply) {
                // 1. Salvar no histórico
                const activeSessionId = chatHistory.currentSessionId || 'default';
                if (!chatHistory.sessions[activeSessionId]) {
                    chatHistory.sessions[activeSessionId] = {
                        id: activeSessionId,
                        title: 'Conversa Geral',
                        timestamp: new Date().toISOString(),
                        messages: []
                    };
                }
                chatHistory.sessions[activeSessionId].messages.push({
                    role: 'assistant',
                    content: reply,
                    timestamp: new Date().toISOString()
                });
                saveChatHistory();

                // 2. Salvar notificação
                notifications.unshift({
                    id: 'notif_' + Math.random().toString(36).substring(2, 9),
                    title: `🔔 Proactive message from ${agent.name}`,
                    message: reply,
                    type: 'info',
                    timestamp: new Date().toISOString(),
                    read: false
                });
                saveNotifications();
                broadcastTelegramMessage(`🤖 *${agent.name} (Proativo)*\n\n${reply}`);
                console.log(`[Scheduler] Mensagem proativa enviada com sucesso pelo agente: ${agent.name}`);
            }
        } else {
            console.error(`[Scheduler] Erro ao buscar resposta proativa. Status: ${response.status}`);
        }
    } catch (err) {
        console.error("[Scheduler] Erro ao obter completions do agente proativo:", err);
    }
}

// Inicializar e rodar o scheduler a cada 1 minuto checando o intervalo
let schedulerMinutesElapsed = 0;
setInterval(() => {
    schedulerMinutesElapsed += 1;
    const checkInterval = config.schedulerInterval || 10;
    if (schedulerMinutesElapsed >= checkInterval) {
        schedulerMinutesElapsed = 0;
        runSchedulerValidation();
        runProactiveAgentsCheck();
    }
}, 60000);

// Executar uma vez no arranque com delay de 5 segundos para não travar o boot
setTimeout(() => {
    runSchedulerValidation();
    runProactiveAgentsCheck();
    syncTelegramBot();
}, 5000);

// ==================== INTEGRACAO TELEGRAM BOT (LONG POLLING NATIVO) ====================
const TELEGRAM_SUBSCRIBERS_FILE = path.join(DATACACHE_DIR, 'telegram_subscribers.json');
let telegramSubscribers = [];
try {
    if (fs.existsSync(TELEGRAM_SUBSCRIBERS_FILE)) {
        telegramSubscribers = fs.readJsonSync(TELEGRAM_SUBSCRIBERS_FILE) || [];
    }
} catch (e) {
    console.error("Erro ao carregar telegram_subscribers.json:", e);
}

function saveTelegramSubscribers() {
    try {
        fs.writeJsonSync(TELEGRAM_SUBSCRIBERS_FILE, telegramSubscribers, { spaces: 2 });
    } catch (e) {
        console.error("Erro ao salvar telegram_subscribers.json:", e);
    }
}

const TELEGRAM_AI_LOGS_FILE = path.join(DATACACHE_DIR, 'telegram_ai_logs.json');
function logTelegramAiInvocation(entry) {
    try {
        let logs = [];
        if (fs.existsSync(TELEGRAM_AI_LOGS_FILE)) {
            logs = fs.readJsonSync(TELEGRAM_AI_LOGS_FILE) || [];
        }
        
        const newLog = {
            id: 'log_' + Math.random().toString(36).substring(2, 9),
            timestamp: new Date().toISOString(),
            ...entry
        };
        
        logs.unshift(newLog);
        if (logs.length > 500) {
            logs = logs.slice(0, 500);
        }
        
        fs.writeJsonSync(TELEGRAM_AI_LOGS_FILE, logs, { spaces: 2 });
    } catch (e) {
        console.error("Erro ao salvar log do Telegram AI:", e);
    }
}

let telegramOffset = 0;
let telegramPollTimer = null;

function sendTelegramMessage(chatId, text, parseMode = 'Markdown') {
    const token = config.telegramBotToken;
    if (!token) return;

    const payload = JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: parseMode || undefined
    });

    const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${token}/sendMessage`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        }
    };

    const req = https.request(options, (res) => {
        let resBody = '';
        res.on('data', c => resBody += c);
        res.on('end', () => {
            try {
                const data = JSON.parse(resBody);
                if (!data.ok) {
                    console.warn(`[Telegram] Falha ao enviar mensagem (parseMode: ${parseMode}): ${data.description}`);
                    if (parseMode) {
                        console.log(`[Telegram] Retentando envio sem parse_mode para evitar erro de markdown...`);
                        sendTelegramMessage(chatId, text, null);
                    }
                }
            } catch(e) {
                console.error("[Telegram] Erro ao ler retorno do sendMessage:", e);
            }
        });
    });
    req.on('error', (e) => {
        console.error("[Telegram] Erro de rede ao enviar mensagem:", e);
    });
    req.write(payload);
    req.end();
}

function sendTelegramMessageWithReply(chatId, text, parseMode = 'Markdown') {
    return new Promise((resolve, reject) => {
        const token = config.telegramBotToken;
        if (!token) return reject(new Error('Token não configurado'));

        const payload = JSON.stringify({
            chat_id: chatId,
            text: text,
            parse_mode: parseMode || undefined
        });

        const options = {
            hostname: 'api.telegram.org',
            port: 443,
            path: `/bot${token}/sendMessage`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };

        const req = https.request(options, (res) => {
            let resBody = '';
            res.on('data', c => resBody += c);
            res.on('end', () => {
                try {
                    const data = JSON.parse(resBody);
                    if (data.ok) {
                        resolve(data.result);
                    } else {
                        if (parseMode) {
                            console.warn(`[Telegram] Falha no sendWithReply (parseMode: ${parseMode}): ${data.description}. Retentando sem parse_mode...`);
                            sendTelegramMessageWithReply(chatId, text, null).then(resolve).catch(reject);
                        } else {
                            reject(new Error(data.description || 'Erro na API do Telegram'));
                        }
                    }
                } catch(e) {
                    reject(e);
                }
            });
        });

        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

function editTelegramMessage(chatId, messageId, newText, parseMode = 'Markdown') {
    const token = config.telegramBotToken;
    if (!token) return;

    const payload = JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text: newText,
        parse_mode: parseMode || undefined
    });

    const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${token}/editMessageText`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        }
    };

    const req = https.request(options, (res) => {
        let resBody = '';
        res.on('data', c => resBody += c);
        res.on('end', () => {
            try {
                const data = JSON.parse(resBody);
                if (!data.ok) {
                    console.warn(`[Telegram] Falha ao editar mensagem (parseMode: ${parseMode}): ${data.description}`);
                    if (parseMode) {
                        console.log(`[Telegram] Retentando edição sem parse_mode para evitar erro de markdown...`);
                        editTelegramMessage(chatId, messageId, newText, null);
                    }
                }
            } catch(e) {
                console.error("[Telegram] Erro ao ler retorno de editMessageText:", e);
            }
        });
    });
    req.on('error', (e) => {
        console.error("[Telegram] Erro de rede ao editar mensagem:", e);
    });
    req.write(payload);
    req.end();
}

function sendTelegramDocument(chatId, filePath, caption = '') {
    const token = config.telegramBotToken;
    if (!token) return;

    try {
        const filename = path.basename(filePath);
        const boundary = '----TelegramBotBoundary' + Math.random().toString(36).substring(2);
        
        if (!fs.existsSync(filePath)) {
            console.error(`[Telegram] Arquivo não encontrado para envio: ${filePath}`);
            return;
        }
        
        const fileData = fs.readFileSync(filePath);

        // Cabeçalho multipart/form-data
        let header = `--${boundary}\r\n`;
        header += `Content-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`;
        if (caption) {
            header += `--${boundary}\r\n`;
            header += `Content-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`;
        }
        header += `--${boundary}\r\n`;
        header += `Content-Disposition: form-data; name="document"; filename="${filename}"\r\n`;
        header += `Content-Type: application/octet-stream\r\n\r\n`;

        const footer = `\r\n--${boundary}--\r\n`;

        const payload = Buffer.concat([
            Buffer.from(header, 'utf8'),
            fileData,
            Buffer.from(footer, 'utf8')
        ]);

        const options = {
            hostname: 'api.telegram.org',
            port: 443,
            path: `/bot${token}/sendDocument`,
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': payload.length
            }
        };

        const req = https.request(options, (res) => {
            let resBody = '';
            res.on('data', c => resBody += c);
            res.on('end', () => {
                console.log(`[Telegram] Documento enviado com status: ${res.statusCode}`);
            });
        });

        req.on('error', (e) => {
            console.error("[Telegram] Erro de rede ao enviar documento:", e);
        });

        req.write(payload);
        req.end();
    } catch (err) {
        console.error("[Telegram] Exceção ao enviar documento:", err);
    }
}

function sendTelegramAction(chatId, action) {
    const token = config.telegramBotToken;
    if (!token) return;

    const payload = JSON.stringify({
        chat_id: chatId,
        action: action
    });

    const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${token}/sendChatAction`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        }
    };

    const req = https.request(options, (res) => {});
    req.on('error', (e) => {
        console.error("[Telegram] Erro ao enviar chat action:", e);
    });
    req.write(payload);
    req.end();
}

function broadcastTelegramMessage(text) {
    if (config.telegramBotEnabled && telegramSubscribers.length > 0) {
        telegramSubscribers.forEach(chatId => {
            sendTelegramMessage(chatId, text);
        });
    }
}

async function handleTelegramUpdate(update) {
    if (!update.message) return;

    const chatId = update.message.chat.id;
    const text = (update.message.text || '').trim();
    const fromUser = update.message.from;
    const username = fromUser.username || '';
    const firstName = fromUser.first_name || '';

    // Segurança: Verificar se usuário está na lista de autorizados
    if (config.telegramAllowedUsers && config.telegramAllowedUsers.trim() !== '') {
        const allowed = config.telegramAllowedUsers.split(',').map(u => u.trim().toLowerCase());
        const cleanUser = username.toLowerCase();
        if (!cleanUser || !allowed.includes(cleanUser)) {
            console.log(`[Telegram] Acesso recusado para o usuário: @${username} (chatId: ${chatId})`);
            sendTelegramMessage(chatId, "❌ *Acesso negado.* Você não está autorizado a interagir com este Media Center.");
            return;
        }
    }

    // Registrar o chatId na lista de inscritos
    if (!telegramSubscribers.includes(chatId)) {
        telegramSubscribers.push(chatId);
        saveTelegramSubscribers();
        console.log(`[Telegram] Novo usuário inscrito: ${username || firstName} (chatId: ${chatId})`);
    }

    // Processar anexos do Telegram (Documentos, Fotos, Vídeos, Áudios, Mensagens de Voz)
    let telegramFileId = null;
    let telegramFileName = 'telegram_file';
    let telegramFileCaption = update.message.caption || '';
    let telegramFileType = 'Documento';

    if (update.message.document) {
        telegramFileId = update.message.document.file_id;
        telegramFileName = update.message.document.file_name || 'documento.bin';
        telegramFileType = 'Documento';
    } else if (update.message.photo) {
        const photos = update.message.photo;
        const largest = photos[photos.length - 1];
        telegramFileId = largest.file_id;
        telegramFileName = `foto_${Date.now()}.jpg`;
        telegramFileType = 'Foto';
    } else if (update.message.video) {
        telegramFileId = update.message.video.file_id;
        telegramFileName = update.message.video.file_name || `video_${Date.now()}.mp4`;
        telegramFileType = 'Vídeo';
    } else if (update.message.audio) {
        telegramFileId = update.message.audio.file_id;
        telegramFileName = update.message.audio.file_name || `audio_${Date.now()}.mp3`;
        telegramFileType = 'Áudio';
    } else if (update.message.voice) {
        telegramFileId = update.message.voice.file_id;
        telegramFileName = `voz_${Date.now()}.ogg`;
        telegramFileType = 'Mensagem de Voz';
    }

    if (telegramFileId) {
        sendTelegramAction(chatId, 'upload_document');
        try {
            console.log(`[Telegram] Baixando anexo (${telegramFileType}): ${telegramFileName}`);
            const filePathOnTelegram = await new Promise((resolve, reject) => {
                https.get(`https://api.telegram.org/bot${config.telegramBotToken}/getFile?file_id=${telegramFileId}`, (res) => {
                    let body = '';
                    res.on('data', chunk => body += chunk);
                    res.on('end', () => {
                        try {
                            const data = JSON.parse(body);
                            if (data.ok && data.result) {
                                resolve(data.result.file_path);
                            } else {
                                reject(new Error(data.description || 'Falha ao buscar file path'));
                            }
                        } catch(e) { reject(e); }
                    });
                }).on('error', reject);
            });

            const localFileName = Date.now() + '-' + telegramFileName;
            const localFilePath = path.join(__dirname, config.agentRagDir || 'public/shared', localFileName);
            
            await new Promise((resolve, reject) => {
                const fileStream = fs.createWriteStream(localFilePath);
                https.get(`https://api.telegram.org/file/bot${config.telegramBotToken}/${filePathOnTelegram}`, (res) => {
                    res.pipe(fileStream);
                    fileStream.on('finish', () => {
                        fileStream.close();
                        resolve();
                    });
                }).on('error', reject);
            });

            // Criar a anotação correspondente linking o arquivo!
            const noteTitle = `${telegramFileType} recebido via Telegram`;
            const noteContent = `Arquivo anexado: ${telegramFileName}\n${telegramFileCaption ? `Legenda/Mensagem: ${telegramFileCaption}\n` : ''}\n📥 **[Anexo: ${telegramFileName}](/shared/${localFileName})**`;
            
            const newNote = {
                id: 'note_' + Math.random().toString(36).substring(2, 9),
                title: noteTitle,
                content: noteContent,
                createdBy: `Telegram (@${username || firstName})`,
                agentId: null,
                timestamp: new Date().toISOString()
            };
            
            notesList.push(newNote);
            await saveNotesAsync();
            
            sendTelegramMessage(chatId, `✅ *Arquivo recebido com sucesso!*\nCriada a anotação: *${noteTitle}* com o anexo.`);
            return;
        } catch (err) {
            console.error("[Telegram] Erro ao baixar arquivo do Telegram:", err);
            sendTelegramMessage(chatId, "❌ Ocorreu um erro ao processar e salvar seu anexo.");
            return;
        }
    }

    if (!text) return; // Se for apenas um arquivo sem texto, encerra aqui.

    console.log(`[Telegram] Mensagem recebida de @${username || firstName}: ${text}`);

    if (text === '/start') {
        sendTelegramMessage(chatId, `👋 Olá *${firstName}*! Eu sou o assistente do *Black Bird Media Center*.\n\nVocê pode falar comigo por aqui para monitorar tarefas, consultar mídias ou gerenciar anotações e treinos!`);
        return;
    }

    if (text === '/selftest') {
        sendTelegramAction(chatId, 'typing');
        let botName = firstName;
        let testMsg = `🤖 *Self-Test: ${botName} Media Center*\n\n`;
        
        // Testar Telegram
        testMsg += `✅ *Telegram Bot API:* OK\n`;
        testMsg += `👤 *Nome do Bot:* ${firstName} (@${username || 'N/A'})\n`;
        
        // Testar Banco de dados
        const dbConfig = fs.existsSync(CONFIG_FILE) ? '✅' : '❌';
        const dbTasks = fs.existsSync(path.join(DATACACHE_DIR, 'tasks.json')) ? '✅' : '❌';
        const dbNotes = fs.existsSync(path.join(DATACACHE_DIR, 'notes.json')) ? '✅' : '❌';
        const dbSubscribers = fs.existsSync(TELEGRAM_SUBSCRIBERS_FILE) ? '✅' : '❌';
        testMsg += `${dbConfig} *Config Database:* Loaded\n`;
        testMsg += `${dbTasks} *Tasks Database:* Loaded\n`;
        testMsg += `${dbNotes} *Notes Database:* Loaded\n`;
        testMsg += `${dbSubscribers} *Subscribers Database:* Loaded\n`;
        
        // Testar Hugging Face
        if (config.hfToken) {
            try {
                const hfRes = await fetch(`https://router.huggingface.co/v1/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${config.hfToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: config.agentModel || 'meta-llama/Llama-3.1-8B-Instruct',
                        messages: [{ role: 'user', content: 'ping' }],
                        max_tokens: 3
                    })
                });
                if (hfRes.ok) {
                    testMsg += `✅ *Hugging Face API:* Connected\n`;
                } else {
                    testMsg += `❌ *Hugging Face API:* Error (Status ${hfRes.status})\n`;
                }
            } catch(e) {
                testMsg += `❌ *Hugging Face API:* Connection failed\n`;
            }
        } else {
            testMsg += `❌ *Hugging Face API:* Token not configured\n`;
        }

        testMsg += `\n👥 *Total de Inscritos:* ${telegramSubscribers.length} usuário(s)\n`;
        sendTelegramMessage(chatId, testMsg);
        return;
    }

    // Encaminhar para o processamento de chat com IA
    const sessionId = 'telegram_' + chatId;
    
    let fallbackMessageId = null;
    let isCompleted = false;

    // Iniciar timer de 2.5 segundos para fallback se a resposta demorar
    const fallbackTimer = setTimeout(async () => {
        if (!isCompleted) {
            try {
                const sentMsg = await sendTelegramMessageWithReply(chatId, "⏳ *Estou analisando seu pedido, um momento por favor...*");
                if (sentMsg && sentMsg.message_id) {
                    fallbackMessageId = sentMsg.message_id;
                }
            } catch (e) {
                console.error("[Telegram] Erro ao enviar mensagem de fallback:", e);
            }
        }
    }, 2500);

    try {
        sendTelegramAction(chatId, 'typing');
        const result = await executeAgentChat(text, sessionId, 'agent_default');
        isCompleted = true;
        clearTimeout(fallbackTimer);

        if (fallbackMessageId) {
            editTelegramMessage(chatId, fallbackMessageId, result.reply);
        } else {
            sendTelegramMessage(chatId, result.reply);
        }

        // Registrar log de invocação da AI pelo Telegram
        logTelegramAiInvocation({
            chatId,
            username,
            firstName,
            message: text,
            agentName: config.agentName || 'Assistente de AI',
            response: result.reply
        });
    } catch (err) {
        isCompleted = true;
        clearTimeout(fallbackTimer);
        console.error("[Telegram] Erro ao processar mensagem do Telegram com IA:", err);
        
        const errorText = "❌ *Desculpe, não consigo ajudar no momento com aquilo.*";
        if (fallbackMessageId) {
            editTelegramMessage(chatId, fallbackMessageId, errorText);
        } else {
            sendTelegramMessage(chatId, errorText);
        }
    }
}

function pollTelegramBot() {
    const token = config.telegramBotToken;
    if (!config.telegramBotEnabled || !token) {
        return;
    }

    const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${telegramOffset}&timeout=30`;
    
    https.get(url, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
            try {
                const data = JSON.parse(body);
                if (data.ok && data.result) {
                    data.result.forEach(update => {
                        telegramOffset = update.update_id + 1;
                        handleTelegramUpdate(update);
                    });
                }
            } catch (e) {
                console.error("[Telegram] Erro ao analisar getUpdates:", e);
            }
            
            // Re-agendar polling
            if (config.telegramBotEnabled) {
                telegramPollTimer = setTimeout(pollTelegramBot, 1000);
            }
        });
    }).on('error', (err) => {
        console.error("[Telegram] Erro de rede no polling:", err.message);
        if (config.telegramBotEnabled) {
            telegramPollTimer = setTimeout(pollTelegramBot, 5000);
        }
    });
}

function syncTelegramBot() {
    if (telegramPollTimer) {
        clearTimeout(telegramPollTimer);
        telegramPollTimer = null;
    }
    
    if (config.telegramBotEnabled && config.telegramBotToken) {
        console.log("[Telegram] Inicializando polling do bot...");
        telegramOffset = 0;
        pollTelegramBot();
    } else {
        console.log("[Telegram] Bot desativado ou sem Token.");
    }
}

server.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});