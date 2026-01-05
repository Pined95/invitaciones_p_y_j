// 👇 URL DEL APPS SCRIPT (ACTUALIZADA)
const API_URL = "https://script.google.com/macros/s/AKfycbxj8mTpblVwa2_pqKR5WpIQ-D0whwVWJxiREY5-yFCq0wjs9KWCEjCzPUL4Fm0DTCA/exec"; 

// Función auxiliar para reintentar si Google falla
async function fetchWithRetry(url, options = {}, retries = 3, backoff = 1000) {
    try {
        const response = await fetch(url, options);
        // Si Google nos dice "Too Many Requests" o error de servidor (5xx)
        if (!response.ok && retries > 0) {
            console.warn(`Reintentando... intentos restantes: ${retries}`);
            await new Promise(r => setTimeout(r, backoff));
            return fetchWithRetry(url, options, retries - 1, backoff * 2); // Espera el doble cada vez
        }
        return response;
    } catch (error) {
        if (retries > 0) {
            console.warn(`Error de red. Reintentando... ${retries}`);
            await new Promise(r => setTimeout(r, backoff));
            return fetchWithRetry(url, options, retries - 1, backoff * 2);
        }
        throw error;
    }
} 

let html5QrcodeScanner = null;
let currentScannedMembers = [];
let audioContext = null;

// Inicializar
document.addEventListener('DOMContentLoaded', () => {
    
    // --- CÓDIGO DE SEGURIDAD (PIN) ---
    const pin = localStorage.getItem('security_pin');
    if(pin !== '2026') { 
        const userPin = prompt("🔐 Ingresa el PIN de seguridad para escanear:");
        if(userPin !== '2026') {
            document.body.innerHTML = '<div style="display:flex; height:100vh; align-items:center; justify-content:center; flex-direction:column;"><h1>⛔ Acceso Denegado</h1><p>No tienes permiso para estar aquí.</p></div>';
            return; 
        }
        localStorage.setItem('security_pin', userPin); 
    }
    // ----------------------------------------

    renderHistory();
    updateSyncButton();

    // Enter para buscar
    const searchInput = document.getElementById('search-input');
    if(searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') manualSearch();
        });
    }

    // Auto-sync on load and when connection is restored
    syncPendingCheckins();
    window.addEventListener('online', syncPendingCheckins);
});

// --- 1. ESCANEAR ---
function startScanner() {
    initAudio();
    document.getElementById('btn-cam').style.display = 'none';
    html5QrcodeScanner = new Html5Qrcode("reader");
    html5QrcodeScanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 },
        (text) => {
            html5QrcodeScanner.pause();
            let id = text;
            try { 
                if(text.includes('id=')) id = new URL(text).searchParams.get('id'); 
            } catch(e){}
            
            fetchGroupInfo(id || text);
        }
    ).catch(e => alert("Error cámara: " + e));
}

// --- 2. CONSULTAR GRUPO (Backend: scanQR) ---
async function fetchGroupInfo(id) {
    const statusText = document.getElementById('status-text');
    statusText.innerText = "Buscando...";
    
    try {
        const res = await fetchWithRetry(`${API_URL}?action=scanQR&id=${encodeURIComponent(id)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        
        const text = await res.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (parseErr) {
            console.error("Error al parsear JSON:", text);
            throw new Error("Respuesta no es JSON válido");
        }
        
        if(data.status === 'success' || data.status === 'SUCCESS') {
            showSelectionModal(data.groupName || data.mainName || data.nombreGrupo, data.members, data.mesa);
            statusText.innerText = "";
        } else {
            alert("⛔ Código no encontrado o sin confirmación.");
            if(html5QrcodeScanner) html5QrcodeScanner.resume();
            statusText.innerText = "Listo para escanear...";
        }
    } catch(e) { 
        console.error(e);
        alert("Error de conexión: " + e.message); 
        if(html5QrcodeScanner) html5QrcodeScanner.resume(); 
    }
}

// --- 3. MOSTRAR MODAL SELECCIÓN ---
function showSelectionModal(name, members, mesa) {
    currentScannedMembers = members; 
    const mode = document.getElementById('checkin-mode').value; 
    
    document.getElementById('modal-group-name').innerText = name || "Invitado";
    document.getElementById('selection-modal').dataset.mesa = mesa; 

    const listDiv = document.getElementById('modal-list');
    listDiv.innerHTML = '';

    members.forEach(m => {
        // Verificar si ya entró (Revisamos si el campo checkInRec o checkInEst tiene texto)
        const alreadyIn = (mode === 'est' ? (m.checkInEst && m.checkInEst.length > 0) : (m.checkInRec && m.checkInRec.length > 0));
        
        listDiv.innerHTML += `
            <div class="guest-check-item">
                <div style="display:flex; align-items:center; width:100%">
                    <input type="checkbox" id="chk_${m.id}" value="${m.id}" ${alreadyIn ? 'disabled checked' : 'checked'}>
                    <label for="chk_${m.id}" style="${alreadyIn ? 'text-decoration:line-through; color:#999' : ''}">${m.nombre}</label>
                </div>
                ${alreadyIn ? '<span class="status-badge badge-in">ADENTRO</span>' : ''}
            </div>
        `;
    });

    document.getElementById('selection-modal').style.display = 'flex';
}

// --- 4. CONFIRMAR ENTRADA (Backend: BATCH_CHECKIN) ---
async function confirmEntry() {
    const mode = document.getElementById('checkin-mode').value;
    const selectedIds = [];
    const selectedNames = [];
    
    currentScannedMembers.forEach(m => {
        const chk = document.getElementById(`chk_${m.id}`);
        if (chk.checked && !chk.disabled) {
            selectedIds.push(m.id);
            selectedNames.push(m.nombre);
        }
    });

    if (selectedIds.length === 0) {
        alert("No has seleccionado a nadie nuevo.");
        return;
    }

    const btn = document.querySelector('#selection-modal .btn-main');
    const originalText = btn.innerText;
    btn.innerText = "Registrando..."; btn.disabled = true;

    const payload = {
        action: 'BATCH_CHECKIN',
        ids: selectedIds,
        mode: mode,
        // Add metadata for offline queue UI
        _groupName: document.getElementById('modal-group-name').innerText,
        _mesa: document.getElementById('selection-modal').dataset.mesa,
        _selectedNames: selectedNames
    };

    try {
        const response = await fetchWithRetry(API_URL, {
            method: 'POST',
            redirect: 'follow', 
            headers: {'Content-Type': 'text/plain;charset=utf-8'},
            body: JSON.stringify(payload)
        });

        const text = await response.text();
        let result;
        try {
            result = JSON.parse(text);
        } catch (parseErr) {
            // Si no es JSON, verificar si la respuesta fue exitosa por el status code
            if (response.ok) {
                result = { status: 'success' };
            } else {
                throw new Error("El servidor no respondió correctamente.");
            }
        }
        
        if (response.ok && (result.status === 'success' || result.status === 'SUCCESS')) {
            closeModal();
            playAudio(true);
            
            addToHistory(payload._groupName, selectedIds.length, mode);
            showFloatingNotification(payload._groupName, payload._mesa, payload._selectedNames);
        } else {
            throw new Error(result.message || "El servidor no respondió correctamente.");
        }

    } catch(e) { 
        console.error(e);
        // --- OFFLINE QUEUE LOGIC ---
        alert("⚠️ Error de conexión. El registro se guardó localmente y se sincronizará automáticamente.");
        savePendingCheckin(payload);
        // We still provide optimistic UI feedback
        closeModal();
        addToHistory(payload._groupName, selectedIds.length, mode, true); // Add pending flag
        showFloatingNotification(payload._groupName, payload._mesa, payload._selectedNames);
    }
    
    btn.innerText = originalText; btn.disabled = false;
}

function closeModal() {
    document.getElementById('selection-modal').style.display = 'none';
}

// --- 5. NOTIFICACIÓN FLOTANTE ---
function showFloatingNotification(name, mesa, membersNames) {
    document.getElementById('notif-title').innerText = name;
    document.getElementById('notif-table').innerText = mesa && mesa !== "Por asignar" ? `MESA ${mesa}` : "SIN MESA";
    
    const listDiv = document.getElementById('notif-members');
    listDiv.innerHTML = membersNames.map(n => `<div class="notify-item">✅ ${n}</div>`).join('');
    
    document.getElementById('scan-notification').classList.add('active');
}

// --- 6. BÚSQUEDA MANUAL ---
async function manualSearch() {
    const q = document.getElementById('search-input').value.trim();
    if(!q) return;
    
    const statusText = document.getElementById('status-text');
    statusText.innerText = "Buscando...";
    
    try {
        const res = await fetchWithRetry(`${API_URL}?action=search&q=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        
        const text = await res.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (parseErr) {
            console.error("Error al parsear JSON:", text);
            throw new Error("Respuesta no es JSON válido");
        }
        
        if(data.results && data.results.length > 0) {
            // Usamos el ID del primer resultado para obtener el grupo completo
            fetchGroupInfo(data.results[0].id);
        } else {
            alert("No encontrado");
            statusText.innerText = "";
        }
    } catch(e) { 
        console.error(e);
        alert("Error en búsqueda: " + e.message); 
        statusText.innerText = "";
    }
}

// --- UTILS (Audio & History) ---
function initAudio() {
    if(!audioContext) audioContext = new (window.AudioContext||window.webkitAudioContext)();
}
function playAudio(success) {
    if(!audioContext) initAudio();
    if(audioContext.state === 'suspended') audioContext.resume();
    
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.connect(gain); gain.connect(audioContext.destination);
    
    if(success) {
        osc.frequency.setValueAtTime(800, audioContext.currentTime);
        osc.frequency.linearRampToValueAtTime(1200, audioContext.currentTime + 0.1);
        gain.gain.value = 0.1;
        osc.start(); osc.stop(audioContext.currentTime + 0.2);
    }
}

function addToHistory(name, count, mode, isPending = false) {
    let log = JSON.parse(localStorage.getItem('checkinLog') || '[]');
    const statusIcon = isPending ? '🕒' : '';
    log.unshift({ name, count, mode, time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}), status: statusIcon });
    if(log.length > 30) log.pop();
    localStorage.setItem('checkinLog', JSON.stringify(log));
    renderHistory();
}

function renderHistory() {
    const div = document.getElementById('history-log');
    const log = JSON.parse(localStorage.getItem('checkinLog') || '[]');
    
    if(log.length === 0) {
        div.innerHTML = '<p style="text-align:center; color:#ccc; margin-top:20px;">No hay registros hoy.</p>';
        return;
    }

    div.innerHTML = log.map(l => `
        <div class="log-item" style="border-left-color: ${l.mode==='est'?'#33ccff':'#C59D5F'}">
            <div class="log-header">
                <span class="log-name">${l.status || ''} ${l.name}</span>
                <span class="log-time">${l.time}</span>
            </div>
            <div class="log-details">
                <span class="tag">${l.mode==='est'?'🚗 Parking':'🥂 Recepción'}</span>
                <span class="tag">${l.count} pers.</span>
            </div>
        </div>
    `).join('');
}

function resetStats() {
    if(confirm("¿Borrar historial local?")) {
        localStorage.removeItem('checkinLog');
        renderHistory();
    }
}

// --- OFFLINE QUEUE FUNCTIONS ---
function getPendingCheckins() {
    return JSON.parse(localStorage.getItem('pendingCheckins') || '[]');
}

function savePendingCheckin(payload) {
    const queue = getPendingCheckins();
    queue.push(payload);
    localStorage.setItem('pendingCheckins', JSON.stringify(queue));
    updateSyncButton();
}

async function syncPendingCheckins() {
    let queue = getPendingCheckins();
    if (queue.length === 0) return;

    const syncButton = document.getElementById('sync-btn');
    if (syncButton) syncButton.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Sincronizando... (${queue.length})`;

    const failed = [];
    
    for (const payload of queue) {
        try {
            const response = await fetchWithRetry(API_URL, {
                method: 'POST',
                redirect: 'follow',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload)
            }, 1); // Only retry once during sync to avoid getting stuck

            if (response.ok) {
                console.log("Check-in pendiente sincronizado:", payload.ids);
            } else {
                failed.push(payload);
            }
        } catch (error) {
            console.warn("Fallo al sincronizar, se reintentará luego:", payload.ids);
            failed.push(payload);
        }
    }

    localStorage.setItem('pendingCheckins', JSON.stringify(failed));
    updateSyncButton();
    if(failed.length === 0) {
        alert("✅ Todos los registros pendientes han sido sincronizados.");
    } else {
        alert(`⚠️ ${failed.length} registros no pudieron sincronizarse. Se reintentará más tarde.`);
    }
}

function updateSyncButton() {
    const syncButton = document.getElementById('sync-btn');
    if (!syncButton) return;
    const queue = getPendingCheckins();
    const count = queue.length;

    if (count > 0) {
        syncButton.style.display = 'flex';
        syncButton.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Sincronizar (${count})`;
        syncButton.style.background = 'var(--error)';
    } else {
        syncButton.style.display = 'none';
    }

}
