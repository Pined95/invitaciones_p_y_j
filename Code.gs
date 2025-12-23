// ==========================================
// 1. CONFIGURACIÓN Y CONSTANTES
// ==========================================
const SPREADSHEET_ID = 'ACTIVE'; 
const SHEET_NAME = 'INVITADOS';
const CACHE_TIME = 1500; // 25 minutos de caché

// MAPA DE COLUMNAS ACTUALIZADO (Con columna X insertada)
const COLS = {
  id: 0,                // A
  grupoId: 1,           // B
  nombrePersona: 2,     // C
  orden: 3,             // D
  telefono: 4,          // E
  correo: 5,            // F
  redSocial: 6,         // G
  
  totalGrupo: 7,        // H
  nombresInvitacion: 8, // I
  nombreGrupo: 9,       // J
  mensaje: 10,          // K
  invitadoCivil: 11,    // L
  
  rsvp: 12,             // M
  alergias: 13,         // N
  menu: 14,             // O
  mesa: 15,             // P
  
  checkInEst: 16,       // Q
  checkInRec: 17,       // R
  
  lado: 18,             // S
  vibra: 19,            // T
  movilidad: 20,        // U
  tags: 21,             // V
  conflicto: 22,        // W

  hideRegistry: 23,     // X (NUEVA: OCULTAR MESAS)
  
  cancion: 24,          // Y (Antes X)
  dedicatoria: 25,      // Z (Antes Y)
  link: 26,             // AA (Antes Z)
  columnaFiltro: 27     // AB (Antes AA)
};

// ==========================================
// 2. ROUTER (MANEJO DE PETICIONES)
// ==========================================

function doGet(e) {
  const action = e.parameter.action;
  const id = e.parameter.id || "ALL";
  const cacheKey = action + "_" + id;
  const cache = CacheService.getScriptCache();
  
  // 1. Intentar servir desde Caché (Velocidad)
  // Excepción: 'getInvite' no se cachea para permitir actualizaciones inmediatas de RSVP
  const cachedContent = cache.get(cacheKey);
  if (cachedContent && action !== 'getInvite') { 
    return ContentService.createTextOutput(cachedContent).setMimeType(ContentService.MimeType.JSON);
  }

  // 2. Procesar lógica
  let responseData = { status: "error", message: "Acción inválida" };

  try {
    if (action === "getInvite" && e.parameter.id) responseData = getGroupData(e.parameter.id);
    else if (action === "scanQR" && e.parameter.id) responseData = getScanInfo(e.parameter.id);
    else if (action === "getStats") responseData = getStats();
    else if (action === "search" && e.parameter.q) responseData = searchGuest(e.parameter.q);
    else if (action === "getAllConfirmed" || action === "getAdminData") responseData = getAllConfirmedGuests();
    else if (action === "getAllGuestsForCheckin") responseData = getCheckinList(); // Para modo offline
    else if (action === "getSendList") responseData = getSendList();
  } catch (err) {
    return createResponse({ status: "error", message: err.toString() });
  }

  // 3. Guardar en Caché y Responder
  if (responseData.status === "success" || responseData.status === "SUCCESS") {
    const jsonString = JSON.stringify(responseData);
    if (jsonString.length < 100000) { 
      cache.put(cacheKey, jsonString, CACHE_TIME);
    }
    return ContentService.createTextOutput(jsonString).setMimeType(ContentService.MimeType.JSON);
  }

  return createResponse(responseData);
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;
    let result = { status: "error" };

    if (action === 'RSVP_GROUP') result = saveGroupRsvp(payload.responses, payload.song, payload.msg);
    else if (action === 'CHECKIN') result = executeCheckIn([payload.id], payload.mode || 'rec');
    else if (action === 'BATCH_CHECKIN') result = executeCheckIn(payload.ids, payload.mode || 'rec'); // Nuevo: Lote offline
    else if (action === 'SAVE_TABLES') result = saveTableAssignments(payload.assignments);
    else if (action === 'setDayB') result = setDayBStatus(payload.value);

    // Limpiar caché global al hacer cambios
    const cache = CacheService.getScriptCache();
    cache.remove('getAdminData_ALL');
    cache.remove('getAllConfirmed_ALL');
    cache.remove('getAllGuestsForCheckin_ALL');
    cache.remove('getStats_ALL');
    
    return createResponse(result);

  } catch (error) {
    return createResponse({ status: "error", message: "JSON Error: " + error.toString() });
  }
}

// ==========================================
// 3. ESTADO "DÍA B" (GLOBAL)
// ==========================================
function getGlobalDayBStatus() {
  const manual = PropertiesService.getScriptProperties().getProperty('IS_DAY_B') === 'true';
  const now = new Date();
  const weddingDate = new Date(2026, 2, 14, 0, 0, 0); // 14 Marzo 2026
  return manual || (now.getTime() >= weddingDate.getTime());
}

function setDayBStatus(value) {
  PropertiesService.getScriptProperties().setProperty('IS_DAY_B', String(value));
  return { status: "success", value: value };
}

// ==========================================
// 4. FUNCIONES DE LÓGICA (DB)
// ==========================================

function getGroupData(mainId) {
  try {
    const sheet = getSheet();
    if (!sheet) {
      return { status: "error", message: "No se pudo acceder a la hoja de cálculo" };
    }
    
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      return { status: "error", message: "No hay datos en la hoja" };
    }
    
    const isDayB = getGlobalDayBStatus();
    const mainIdStr = String(mainId).trim();
    
    let targetGroupId = null;
    let result = { status: "error", message: "Invitación no encontrada" };

    for (let i = 1; i < data.length; i++) {
      const rowId = String(data[i][COLS.id] || "").trim();
      const rowGroup = String(data[i][COLS.grupoId] || "").trim();
      
      if (rowId === mainIdStr || rowGroup === mainIdStr) {
        targetGroupId = data[i][COLS.grupoId];
        
        const civilVal = String(data[i][COLS.invitadoCivil] || "").toUpperCase();
        const showCivil = (civilVal === 'SI' || civilVal === 'TRUE' || civilVal === 'SÍ');

        // LÓGICA NUEVA: OCULTAR REGALOS (COLUMNA X)
        const hideVal = String(data[i][COLS.hideRegistry] || "").toUpperCase();
        const hideRegistry = (hideVal === 'SI' || hideVal === 'TRUE' || hideVal === 'OCULTAR');

        result = {
          status: "success",
          id: mainIdStr,
          isDayB: isDayB,
          nombreGrupo: data[i][COLS.nombreGrupo] || "",
          nombresInvitacion: data[i][COLS.nombresInvitacion] || "",
          mainName: data[i][COLS.nombrePersona] || "",
          mensaje: data[i][COLS.mensaje] || "",
          showCivil: showCivil,
          hideRegistry: hideRegistry,
          members: []
        };
        break;
      }
    }

    if (targetGroupId) {
      const targetGroupIdStr = String(targetGroupId);
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][COLS.grupoId] || "") === targetGroupIdStr) {
          result.members.push({
            id: String(data[i][COLS.id] || ""),
            nombre: String(data[i][COLS.nombrePersona] || ""),
            estado: String(data[i][COLS.rsvp] || "PENDIENTE"),
            alergias: String(data[i][COLS.alergias] || ""),
            mesa: String(data[i][COLS.mesa] || "Por asignar"),
            orden: Number(data[i][COLS.orden]) || 99,
            mensaje: String(data[i][COLS.mensaje] || ""),
            checkInEst: String(data[i][COLS.checkInEst] || ""),
            checkInRec: String(data[i][COLS.checkInRec] || "")
          });
        }
      }
      result.members.sort((a, b) => a.orden - b.orden);
    }
    return result;
  } catch (error) {
    return { status: "error", message: error.toString() };
  }
}

// --- FUNCIÓN CORREGIDA CON BLOQUEO ---
function saveGroupRsvp(responses, song, msg) {
  // 1. BLOQUEO DE SEGURIDAD (Evita colisiones)
  const lock = LockService.getScriptLock();
  try {
      lock.waitLock(10000); // Espera hasta 10 segundos
  } catch (e) {
      return { status: "error", message: "Servidor ocupado. Intenta de nuevo." };
  }

  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  const cache = CacheService.getScriptCache();

  // 2. MAPEO RÁPIDO ID -> FILA
  const idMap = new Map();
  for(let i=1; i<data.length; i++) {
     idMap.set(String(data[i][COLS.id]).trim(), i + 1);
  }

  // 3. GUARDADO
  responses.forEach((resp, idx) => {
    cache.remove('getInvite_' + resp.id); 
    
    const row = idMap.get(String(resp.id).trim());
    if (row) {
        sheet.getRange(row, COLS.rsvp + 1).setValue(resp.rsvp);
        sheet.getRange(row, COLS.alergias + 1).setValue(resp.alergias);
        
        // Guardar canción y mensaje en la fila del primer miembro (o líder)
        if (idx === 0) {
          if (song) sheet.getRange(row, COLS.cancion + 1).setValue(song);
          if (msg) sheet.getRange(row, COLS.dedicatoria + 1).setValue(msg);
        }
    }
  });

  SpreadsheetApp.flush();
  lock.releaseLock();
  return { status: "success" };
}

// --- CHECK-IN Y APP DE RECEPCIÓN ---

function getCheckinList() {
  try {
    const sheet = getSheet();
    if (!sheet) {
      return { status: "error", message: "No se pudo acceder a la hoja de cálculo" };
    }
    
    const data = sheet.getDataRange().getValues();
    const guests = [];

    for (let i = 1; i < data.length; i++) {
      const rsvp = String(data[i][COLS.rsvp] || "").toUpperCase();
      if (rsvp.includes('SI') || rsvp.includes('SÍ') || rsvp.includes('CONFIRMADO')) {
       guests.push({
         id: String(data[i][COLS.id] || ""),
         nombre: String(data[i][COLS.nombrePersona] || ""),
         mesa: String(data[i][COLS.mesa] || "Por asignar"),
         pases: 1, 
         tags: String(data[i][COLS.tags] || ""),
         checkinTime: String(data[i][COLS.checkInRec] || ""),
         checkInEst: String(data[i][COLS.checkInEst] || ""),
         checkInRec: String(data[i][COLS.checkInRec] || "")
       });
      }
    }
    return { status: "success", guests: guests };
  } catch (error) {
    return { status: "error", message: error.toString() };
  }
}

function executeCheckIn(ids, mode) {
  try {
    const sheet = getSheet();
    if (!sheet) {
      return { status: "error", message: "No se pudo acceder a la hoja de cálculo" };
    }
    
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      return { status: "error", message: "No hay datos en la hoja" };
    }
    
    const idMap = new Map();
    for(let i=1; i<data.length; i++) {
      idMap.set(String(data[i][COLS.id]).trim(), i + 1);
    }

    const colToMark = (mode === 'est') ? COLS.checkInEst + 1 : COLS.checkInRec + 1;
    const timestamp = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const val = `SÍ (${timestamp})`;

    let updated = 0;
    ids.forEach(id => {
      const idStr = String(id).trim();
      if(idMap.has(idStr)) {
        const row = idMap.get(idStr);
        sheet.getRange(row, colToMark).setValue(val);
        updated++;
      }
    });

    SpreadsheetApp.flush();
    return { status: "success", updated: updated };
  } catch (error) {
    return { status: "error", message: error.toString() };
  }
}

function getScanInfo(id) {
  const result = getGroupData(id);
  // Asegurar que se incluya la mesa en el resultado para el check-in
  if (result.status === "success" && result.members && result.members.length > 0) {
    // La mesa ya está incluida en cada miembro, pero también podemos agregarla al nivel superior
    result.mesa = result.members[0].mesa || "Por asignar";
  }
  return result;
}

function searchGuest(query) {
    const sheet = getSheet();
    const data = sheet.getDataRange().getValues();
    const results = [];
    const q = query.toString().toLowerCase();

    for (let i = 1; i < data.length; i++) {
        const nombre = String(data[i][COLS.nombrePersona]).toLowerCase();
        if (nombre.includes(q)) {
             const rsvp = String(data[i][COLS.rsvp]).toUpperCase();
             if (rsvp.includes('SI') || rsvp.includes('SÍ')) {
                 results.push({
                     id: data[i][COLS.id],
                     nombre: data[i][COLS.nombrePersona],
                     mesa: data[i][COLS.mesa],
                     yaEntro: String(data[i][COLS.checkInRec]).length > 0
                 });
             }
        }
        if(results.length > 15) break; 
    }
    return { status: "success", results: results };
}

// --- ADMIN Y CROQUIS ---

function getAllConfirmedGuests() {
  try {
    const sheet = getSheet();
    if (!sheet) {
      return { status: "error", message: "No se pudo acceder a la hoja de cálculo" };
    }
    
    const data = sheet.getDataRange().getValues();
    const guests = [];
    const isDayB = getGlobalDayBStatus();

    for (let i = 1; i < data.length; i++) {
      if (!data[i][COLS.nombrePersona]) continue;
      
      const filtro = Number(data[i][COLS.columnaFiltro] || 0);
      if (filtro <= 100) continue;

      guests.push({
        id: String(data[i][COLS.id] || ""),
        groupId: String(data[i][COLS.grupoId] || ""),
        nombre: String(data[i][COLS.nombrePersona] || ""),
        mesa: String(data[i][COLS.mesa] || "Por asignar"),
        lado: String(data[i][COLS.lado] || ""),
        vibra: String(data[i][COLS.vibra] || ""),
        movilidad: String(data[i][COLS.movilidad] || ""),
        tags: String(data[i][COLS.tags] || ""),
        conflicto: String(data[i][COLS.conflicto] || ""),
        orden: Number(data[i][COLS.orden]) || 99,
        rsvp: String(data[i][COLS.rsvp] || ""),
        alergias: String(data[i][COLS.alergias] || ""),
        mensaje: String(data[i][COLS.dedicatoria] || ""),
        cancion: String(data[i][COLS.cancion] || "") 
      });
    }
    return { status: "success", guests: guests, isDayB: isDayB };
  } catch (error) {
    return { status: "error", message: error.toString() };
  }
}

// --- ENVÍO WHATSAPP ---

function getSendList() {
  try {
    const sheet = getSheet();
    if (!sheet) {
      return { status: "error", message: "No se pudo acceder a la hoja de cálculo" };
    }
    
    const data = sheet.getDataRange().getValues();
    const guests = [];

    for (let i = 1; i < data.length; i++) {
      const filtro = Number(data[i][COLS.columnaFiltro] || 0);
      if (filtro > 100 && data[i][COLS.nombrePersona]) {
        guests.push({
          id: String(data[i][COLS.id] || ""),
          groupId: String(data[i][COLS.grupoId] || ""),
          nombre: String(data[i][COLS.nombrePersona] || ""),
          nombreGrupo: String(data[i][COLS.nombreGrupo] || data[i][COLS.nombresInvitacion] || ""),
          telefono: String(data[i][COLS.telefono] || ""),
          link: String(data[i][COLS.link] || ""),
          rsvp: String(data[i][COLS.rsvp] || "")
        });
      }
    }
    return { status: "success", guests: guests };
  } catch (error) {
    return { status: "error", message: error.toString() };
  }
}

function saveTableAssignments(assignments) {
  try {
    const sheet = getSheet();
    if (!sheet) {
      return { status: "error", message: "No se pudo acceder a la hoja de cálculo" };
    }
    
    const data = sheet.getDataRange().getValues();
    const idMap = {};
    for(let i=1; i<data.length; i++) {
      idMap[String(data[i][COLS.id]).trim()] = i + 1;
    }
    
    let updated = 0;
    assignments.forEach(item => {
      const idStr = String(item.id).trim();
      if (idMap[idStr] && item.mesa) {
        sheet.getRange(idMap[idStr], COLS.mesa + 1).setValue(String(item.mesa));
        updated++;
      }
    });
    
    SpreadsheetApp.flush();
    
    // Limpiar caché relacionado
    const cache = CacheService.getScriptCache();
    cache.remove('getAdminData_ALL');
    cache.remove('getAllConfirmed_ALL');
    
    return { status: "success", updated: updated };
  } catch (error) {
    return { status: "error", message: error.toString() };
  }
}

// --- UTILIDADES ---
function getSheet() {
  try {
    let spreadsheet;
    if (SPREADSHEET_ID === 'ACTIVE') {
      spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    } else {
      spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    }
    
    if (!spreadsheet) {
      throw new Error("No se pudo abrir la hoja de cálculo");
    }
    
    const sheet = spreadsheet.getSheetByName(SHEET_NAME);
    if (!sheet) {
      throw new Error("No se encontró la hoja: " + SHEET_NAME);
    }
    
    return sheet;
  } catch (error) {
    console.error("Error en getSheet:", error);
    return null;
  }
}

function createResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function getStats() {
    // Función dummy para que no falle si el frontend viejo la llama
    return { status: "success", stats: {} };
}