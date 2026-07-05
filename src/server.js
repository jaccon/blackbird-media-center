require('dotenv').config(); // Carrega as variáveis do .env
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
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
    appAddress: ''
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

// Middleware de Autenticação Global
function authMiddleware(req, res, next) {
    // Make config globally available in views
    res.locals.config = config;

    // Se a autenticação global não estiver ativa, prossegue
    if (!config.authEnabled) {
        return next();
    }

    // Rotas públicas que não requerem autenticação
    const publicPaths = ['/login', '/login/auth', '/remote', '/upload-chunk', '/css', '/js', '/images', '/favicon.ico'];
    const isPublic = publicPaths.some(p => req.path.startsWith(p));
    if (isPublic) {
        return next();
    }

    // Verificar se o usuário está autenticado
    const cookies = getCookies(req);
    if (cookies.authenticated === 'true') {
        return next();
    }

    // Redireciona para o login
    res.redirect('/login');
}

let promptHistory = [];

// Configuração do EJS como template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Dicionário de Traduções (Inglês padrão, Português e Espanhol)
const translations = {
    en: {
        dashboard: "Dashboard",
        explorer: "Explorer",
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
    },
    pt: {
        dashboard: "Dashboard",
        explorer: "Explorer",
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
    },
    es: {
        dashboard: "Dashboard",
        explorer: "Explorador",
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
    }
};

// Middleware para injeção de internacionalização (i18n)
app.use((req, res, next) => {
    const lang = config.language || 'en';
    const dict = translations[lang] || translations['en'];
    res.locals.t = (key) => dict[key] || translations['en'][key] || key;
    res.locals.currentLang = lang;
    
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
    const currentPath = req.query.path || '';
    const search = req.query.search || '';
    
    const filteredFavorites = favorites.filter(file => !isPathHidden(file, true));
    
    if (search) {
        // Busca recursiva global filtrada
        let files = getRecursiveFiles(path.join(__dirname, SHARED_DIR));
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
    const { chunkIndex, totalChunks, fileName, currentPath } = req.query;

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
    const finalPath = path.join(__dirname, SHARED_DIR, currentPath || '', fileName);

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
            res.json({ success: true, message: 'Upload concluído!' });
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
    const currentPath = req.body.path || '';
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
    const currentPath = req.body.path || '';
    const filePath = path.join(__dirname, SHARED_DIR, currentPath, fileName);
    if (fs.existsSync(filePath)) {
        fs.removeSync(filePath);
    }
    res.redirect(`/explorer?path=${currentPath}`);
});

// Rota para remover diretórios
app.post('/delete-dir', express.urlencoded({ extended: true }), (req, res) => {
    const dirName = req.body.dir;
    const currentPath = req.body.path || '';
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
    let files = getRecursiveFiles(path.join(__dirname, SHARED_DIR));
    
    files = files.filter(f => f.name.match(/\.(mp4|webm|ogg|mkv|mov)$/i));
    
    if (search) {
        files = files.filter(f => f.name.toLowerCase().includes(search.toLowerCase()));
    }
    
    files.sort((a, b) => b.mtime - a.mtime);
    
    const filteredFavorites = favorites.filter(file => !isPathHidden(file, true));
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
    let files = getRecursiveFiles(path.join(__dirname, SHARED_DIR));
    
    files = files.filter(f => f.name.match(/\.(jpg|jpeg|png|gif)$/i));
    
    if (search) {
        files = files.filter(f => f.name.toLowerCase().includes(search.toLowerCase()));
    }
    
    files.sort((a, b) => b.mtime - a.mtime);
    
    const filteredFavorites = favorites.filter(file => !isPathHidden(file, true));
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
    let files = getRecursiveFiles(path.join(__dirname, SHARED_DIR));
    
    files = files.filter(f => f.name.match(/\.(mp3|wav|ogg|aac|flac)$/i));
    
    if (search) {
        files = files.filter(f => f.name.toLowerCase().includes(search.toLowerCase()));
    }
    
    files.sort((a, b) => b.mtime - a.mtime);
    
    const filteredFavorites = favorites.filter(file => !isPathHidden(file, true));
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
        allFiles = getRecursiveFiles(path.join(__dirname, SHARED_DIR), '', true);
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
                // Excluir do histórico se o arquivo foi deletado ou foi ocultado pelo usuário
                return fs.existsSync(fullPath) && !isPathHidden(item.file, true);
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

    const filteredFavorites = favorites.filter(file => !isPathHidden(file, true));
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
    res.render('login', { error: null });
});

app.post('/login/auth', express.urlencoded({ extended: true }), (req, res) => {
    const { password } = req.body;
    if (password === config.loginPassword) {
        res.cookie('authenticated', 'true', { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, path: '/' });
        return res.redirect('/');
    }
    res.render('login', { error: 'incorrect_password' });
});

app.get('/logout', (req, res) => {
    res.clearCookie('authenticated', { path: '/' });
    res.redirect('/login');
});

// Rota do Controle Remoto Mobile
app.get('/remote', (req, res) => {
    res.render('remote', { config });
});

// Rotas de Configurações do Sistema
app.get('/settings', (req, res) => {
    const successMsg = req.query.success === 'true' ? 'Configurações salvas com sucesso!' : null;
    res.render('settings', { config, successMsg });
});

app.post('/settings/save', express.urlencoded({ extended: true }), (req, res) => {
    const authEnabled = req.body.authEnabled === 'true';
    const loginPassword = req.body.loginPassword || 'admin';
    const allowedExtensions = req.body.allowedExtensions || '';
    const language = req.body.language || 'en';
    const appAddress = req.body.appAddress || '';

    config.authEnabled = authEnabled;
    config.loginPassword = loginPassword;
    config.allowedExtensions = allowedExtensions;
    config.language = language;
    let cleanAddress = appAddress.trim().replace(/\/$/, '');
    if (cleanAddress && !/^https?:\/\//i.test(cleanAddress)) {
        cleanAddress = 'http://' + cleanAddress;
    }
    config.appAddress = cleanAddress;

    // Sincronizar a senha da área oculta com a senha de login configurada
    hiddenPassword = loginPassword;

    try {
        fs.writeJsonSync(CONFIG_FILE, config, { spaces: 2 });
        fs.writeJsonSync(PASSWORD_FILE, { password: hiddenPassword }, { spaces: 2 });
        
        if (!authEnabled) {
            res.clearCookie('authenticated', { path: '/' });
        }
        res.redirect('/settings?success=true');
    } catch (e) {
        console.error("Erro ao salvar config.json:", e);
        res.status(500).send("Erro interno ao salvar as configurações.");
    }
});

// Rota de Exportação de Configurações e Setup de Arquivos
app.get('/settings/export', (req, res) => {
    try {
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

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=blackbird_backup.json');
        res.send(JSON.stringify(backup, null, 2));
    } catch (e) {
        console.error("Erro ao exportar configurações:", e);
        res.status(500).send("Erro ao exportar configurações.");
    }
});

// Rota de Importação de Configurações e Setup de Arquivos
const multer = require('multer');
const importUpload = multer({ dest: path.join(__dirname, 'datacache') });

app.post('/settings/import', importUpload.single('backupFile'), (req, res) => {
    if (!req.file) {
        return res.status(400).send("Nenhum arquivo de backup enviado.");
    }

    const tempFilePath = req.file.path;
    try {
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
            if (data.password.password) {
                hiddenPassword = data.password.password;
            }
        }
        if (data.config) {
            fs.writeJsonSync(CONFIG_FILE, data.config, { spaces: 2 });
            config = { ...config, ...data.config };
        }

        fs.removeSync(tempFilePath);
        res.redirect('/settings?success=true');
    } catch (e) {
        console.error("Erro ao importar configurações:", e);
        if (fs.existsSync(tempFilePath)) {
            fs.removeSync(tempFilePath);
        }
        res.status(500).send("Erro ao importar backup. Verifique se o arquivo JSON é válido.");
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

const http = require('http');
const WebSocket = require('ws');

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    ws.id = crypto.randomBytes(8).toString('hex');
    ws.role = 'unknown';
    ws.authorized = false;
    ws.playerId = null;
    ws.pairId = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'register') {
                ws.role = data.role;
                ws.userAgent = data.userAgent || 'Celular';
                
                if (ws.role === 'player') {
                    ws.playerId = data.playerId;
                    console.log(`Player registrado (ID: ${ws.id}, PlayerSessionId: ${ws.playerId})`);
                } else if (ws.role === 'remote') {
                    ws.pairId = data.pairId;
                    console.log(`Remote registrado (ID: ${ws.id}, PairTargetId: ${ws.pairId})`);

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

server.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});