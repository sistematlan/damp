// ── i18n — Bilingual Support (EN/ES) ──────────────────

const translations = {
  en: {
    // Nav
    overview: 'Overview',
    projects: 'Projects',
    databases: 'Databases',
    logs: 'Logs',

    // Overview
    containersRunning: 'Containers Running',
    runtimeHealth: 'Runtime health',
    containerMemory: 'container memory',
    bounded: 'bounded',
    warnings: 'warnings',
    unbounded: 'unbounded',
    noRuntimeSamples: 'No runtime samples available',
    controlPlane: 'control plane',
    serviceActionComplete: 'Service state updated',
    startMinimal: 'Start minimal core',
    minimalStarted: 'Minimal core started',
    dampEngine: 'DAMP Engine',
    start: 'Start',
    stop: 'Stop',
    starting: 'Starting...',
    stopping: 'Stopping...',
    quickAccess: 'Quick Access',
    services: 'Services',
    reverseProxy: 'Reverse Proxy',
    emailTesting: 'Email Testing',
    dbManagement: 'DB Management',
    cache: 'Cache',
    dns: 'DNS Resolver',

    // Projects
    newProject: 'New Project',
    adoptProject: 'Add Existing Folder',
    adoptHint: 'Register an existing project folder with DAMP (creates DB + Caddy config)',
    projectPath: 'Project path',
    adding: 'Adding...',
    failedAdopt: 'Failed to add project',
    create: 'Create',
    creating: 'Creating...',
    refresh: 'Refresh',
    noProjects: 'No projects yet',
    noProjectsHint: 'Create your first project above',
    templates: 'Templates',
    scaffoldHint: 'New project from scratch:',
    existingHint: 'Existing project:',
    scaffoldFiles: 'Scaffold files',
    creatingDbCaddy: 'Creating database and Caddy config...',
    failedCreate: 'Failed to create project',
    repair: 'Repair',
    relinkFolder: 'Relink Folder',
    missingCompose: 'Missing docker-compose.yml',
    folderNotFound: 'Folder not found',
    unlinked: 'Unlinked',
    fixProject: 'Fix Project',

    // Databases
    mysqlDatabases: 'MySQL Databases',
    postgresDatabases: 'PostgreSQL Databases',
    createDatabase: 'Create Database',
    noDatabases: 'No databases',
    connected: 'Connected',
    offline: 'Offline',

    // Logs
    selectContainer: 'Select container...',
    clear: 'Clear',
    autoScroll: 'Auto-scroll',
    selectContainerHint: 'Select a container to view logs...',
    connecting: 'Connecting to',
    connectionLost: '[Connection lost. Reconnecting...]',
    reconnecting: 'Reconnecting',

    // Shared
    containers: 'containers',
    cannotConnect: 'Cannot connect to DAMP API',
    cannotLoad: 'Cannot load',
    error: 'Error',
    active: 'Active',
    stopped: 'Stopped',
    running: 'Running',
    no_containers: 'No containers found',
    cancel: 'Cancel',
    select_folder: 'Select Folder',
    select_this_folder: 'Select this folder',
    please_select_folder: 'Please select a folder first',
    empty_directory: 'Empty directory',
    project_preview: 'Project Preview',
    domain: 'Domain',
    database: 'Database',
  },
  es: {
    // Nav
    overview: 'General',
    projects: 'Proyectos',
    databases: 'Bases de datos',
    logs: 'Logs',

    // Overview
    containersRunning: 'Contenedores Activos',
    runtimeHealth: 'Salud de ejecución',
    containerMemory: 'memoria en contenedores',
    bounded: 'con límite',
    warnings: 'alertas',
    unbounded: 'sin límite',
    noRuntimeSamples: 'No hay muestras de ejecución disponibles',
    controlPlane: 'plano de control',
    serviceActionComplete: 'Estado del servicio actualizado',
    startMinimal: 'Iniciar núcleo mínimo',
    minimalStarted: 'Núcleo mínimo iniciado',
    dampEngine: 'Motor DAMP',
    start: 'Iniciar',
    stop: 'Detener',
    starting: 'Iniciando...',
    stopping: 'Deteniendo...',
    quickAccess: 'Acceso Rápido',
    services: 'Servicios',
    reverseProxy: 'Proxy Inverso',
    emailTesting: 'Email de Prueba',
    dbManagement: 'Gestión de BD',
    cache: 'Caché',
    dns: 'Resolución DNS',

    // Projects
    newProject: 'Nuevo Proyecto',
    adoptProject: 'Agregar Carpeta Existente',
    adoptHint: 'Registra una carpeta de proyecto existente en DAMP (crea BD + config Caddy)',
    projectPath: 'Ruta del proyecto',
    adding: 'Agregando...',
    failedAdopt: 'Error al agregar proyecto',
    create: 'Crear',
    creating: 'Creando...',
    refresh: 'Actualizar',
    noProjects: 'Sin proyectos',
    noProjectsHint: 'Crea tu primer proyecto arriba',
    templates: 'Plantillas',
    scaffoldHint: 'Proyecto nuevo desde cero:',
    existingHint: 'Proyecto existente:',
    scaffoldFiles: 'Copiar archivos',
    creatingDbCaddy: 'Creando base de datos y config de Caddy...',
    failedCreate: 'Error al crear proyecto',
    repair: 'Reparar',
    relinkFolder: 'Vincular carpeta',
    missingCompose: 'Falta docker-compose.yml',
    folderNotFound: 'Carpeta no encontrada',
    unlinked: 'Sin vínculo',
    fixProject: 'Arreglar Proyecto',

    // Databases
    mysqlDatabases: 'Bases MySQL',
    postgresDatabases: 'Bases PostgreSQL',
    createDatabase: 'Crear Base de Datos',
    noDatabases: 'Sin bases de datos',
    connected: 'Conectado',
    offline: 'Desconectado',

    // Logs
    selectContainer: 'Seleccionar contenedor...',
    clear: 'Limpiar',
    autoScroll: 'Auto-scroll',
    selectContainerHint: 'Selecciona un contenedor para ver logs...',
    connecting: 'Conectando a',
    connectionLost: '[Conexión perdida. Reconectando...]',
    reconnecting: 'Reconectando',

    // Shared
    containers: 'contenedores',
    cannotConnect: 'No se puede conectar a la API de DAMP',
    cannotLoad: 'No se puede cargar',
    error: 'Error',
    active: 'Activo',
    stopped: 'Detenido',
    running: 'Activo',
    no_containers: 'No se encontraron contenedores',
    cancel: 'Cancelar',
    select_folder: 'Seleccionar Carpeta',
    select_this_folder: 'Seleccionar esta carpeta',
    please_select_folder: 'Por favor selecciona una carpeta primero',
    empty_directory: 'Directorio vacío',
    project_preview: 'Vista previa del proyecto',
    domain: 'Dominio',
    database: 'Base de datos',
  }
};

let currentLang = localStorage.getItem('damp-lang') || 'en';

function t(key) {
  return (translations[currentLang] && translations[currentLang][key]) || translations.en[key] || key;
}

function setLang(lang) {
  currentLang = lang;
  localStorage.setItem('damp-lang', lang);
  document.documentElement.lang = lang; // (F12)

  // Update nav labels
  document.querySelector('[data-view="overview"]').innerHTML = '<span class="nav-icon" aria-hidden="true">&#9673;</span> ' + t('overview');
  document.querySelector('[data-view="projects"]').innerHTML = '<span class="nav-icon" aria-hidden="true">&#9881;</span> ' + t('projects');
  document.querySelector('[data-view="databases"]').innerHTML = '<span class="nav-icon" aria-hidden="true">&#9707;</span> ' + t('databases');
  document.querySelector('[data-view="logs"]').innerHTML = '<span class="nav-icon" aria-hidden="true">&#9783;</span> ' + t('logs');
  
  // Update lang toggle
  document.querySelectorAll('.lang-btn').forEach(function(btn) {
    var active = btn.dataset.lang === lang;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active);
  });
  
  // Re-render current view
  var path = location.hash.slice(1) || '/';
  navigate(path);
}
