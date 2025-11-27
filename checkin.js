// 👇 URL DEL APPS SCRIPT (Tu Backend)
const API_URL = "https://script.google.com/macros/s/AKfycbxkWDPOJ4q4P81f9DDyVs8cWwV7wEz7_hk9YdNOZvYQYTwtetc-VNtqpqsANmMcbQE/exec"; 

let html5QrcodeScanner = null;
let currentScannedMembers = [];
let audioContext = null;

// Inicializar
document.addEventListener('DOMContentLoaded', () => {
    
    // --- NUEVO: CÓDIGO DE SEGURIDAD (PIN) ---
    const pin = localStorage.getItem('security_pin');
    if(pin !== '2026') { // <--- Puedes cambiar '2026' por el número que quieras
        const userPin = prompt("🔐 Ingresa el PIN de seguridad para escanear:");
        if(userPin !== '2026') {
            document.body.innerHTML = '<div style="display:flex; height:100vh; align-items:center; justify-content:center; flex-direction:column;"><h1>⛔ Acceso Denegado</h1><p>No tienes permiso para estar aquí.</p></div>';
            return; // Esto detiene todo el sistema
        }
        localStorage.setItem('security_pin', userPin); // Guarda el PIN para que no lo pida a cada rato
    }
    // ----------------------------------------

    renderHistory();
    // Enter para buscar
    const searchInput = document.getElementById('search-input');
    if(searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') manualSearch();
        });
    }
});

// --- 1. ESCANEAR ---
function startScanner() {
    document.getElementById('btn-cam').style.display = 'none';
    html5QrcodeScanner = new Html5Qrcode("reader");
    html5QrcodeScanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 },
        (text) => {
            html5QrcodeScanner.pause();
            let id = text;
            // Intentar limpiar si es URL completa
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
        const res = await fetch(`${API_URL}?action=scanQR&id=${encodeURIComponent(id)}`);
        const data = await res.json();
        
        if(data.status === 'SUCCESS') {
            showSelectionModal(data.groupName, data.members, data.mesa);
            statusText.innerText = "";
        } else {
            alert("⛔ Código no encontrado o sin confirmación.");
            html5QrcodeScanner.resume();
            statusText.innerText = "Listo para escanear...";
        }
    } catch(e) { 
        alert("Error de conexión"); 
        if(html5QrcodeScanner) html5QrcodeScanner.resume(); 
    }
}

// --- 3. MOSTRAR MODAL SELECCIÓN ---
function showSelectionModal(name, members, mesa) {
    currentScannedMembers = members; // Guardar para uso posterior
    const mode = document.getElementById('checkin-mode').value; // 'est' o 'rec'
    
    document.getElementById('modal-group-name').innerText = name;
    // Guardamos la mesa en un atributo temporal del modal para usarla al confirmar
    document.getElementById('selection-modal').dataset.mesa = mesa; 

    const listDiv = document.getElementById('modal-list');
    listDiv.innerHTML = '';

    members.forEach(m => {
        // Verificar si ya entró en este modo
        const alreadyIn = (mode === 'est' ? m.inEst : m.inRec);
        
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

// --- 4. CONFIRMAR ENTRADA (Backend: DO_CHECKIN) ---
async function confirmEntry() {
    const mode = document.getElementById('checkin-mode').value;
    const selectedIds = [];
    const selectedNames = [];
    
    // Recopilar seleccionados NUEVOS (no deshabilitados)
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

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            redirect: 'follow', // Importante para que funcione con Google
            headers: {'Content-Type': 'text/plain;charset=utf-8'},
            body: JSON.stringify({
                action: 'DO_CHECKIN',
                ids: selectedIds,
                mode: mode
            })
        });

        if (response.ok) {
            // Si el servidor dice "OK", procedemos
            const result = await response.json(); // Opcional: leer respuesta del servidor
            
            // Éxito: Cerrar modal, sonar "bip" y mostrar notificación
            closeModal();
            playAudio(true);
            
            // Preparar datos para notificación y log
            const groupName = document.getElementById('modal-group-name').innerText;
            const mesa = document.getElementById('selection-modal').dataset.mesa;
            
            // Agregar al historial local
            addToHistory(groupName, selectedIds.length, mode);
            
            // Mostrar Notificación Flotante
            showFloatingNotification(groupName, mesa, selectedNames);
        } else {
            throw new Error("El servidor no respondió correctamente.");
        }

    } catch(e) { 
        console.error(e);
        alert("⚠️ Error: No se pudo registrar la entrada. Revisa tu conexión a internet."); 
    }
    
    btn.innerText = originalText; btn.disabled = false;
}

function closeModal() {
    document.getElementById('selection-modal').style.display = 'none';
    // No reanudamos cámara aquí, esperamos a que cierren la notificación flotante
}

// --- 5. NOTIFICACIÓN FLOTANTE ---
function showFloatingNotification(name, mesa, membersNames) {
    document.getElementById('notif-title').innerText = name;
    document.getElementById('notif-table').innerText = mesa && mesa !== "Sin Asignar" ? `MESA ${mesa}` : "SIN MESA";
    
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
        const res = await fetch(`${API_URL}?action=search&q=${encodeURIComponent(q)}`);
        const data = await res.json();
        
        // Si hay resultados, usamos el primero para abrir el flujo normal
        // (En una versión pro, mostraríamos lista para elegir, pero esto simplifica)
        if(data.results && data.results.length > 0) {
            // Llamamos a fetchGroupInfo con el ID del primer resultado
            fetchGroupInfo(data.results[0].id);
        } else {
            alert("No encontrado");
            statusText.innerText = "";
        }
    } catch(e) { alert("Error busqueda"); }
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

function addToHistory(name, count, mode) {
    let log = JSON.parse(localStorage.getItem('checkinLog') || '[]');
    log.unshift({ name, count, mode, time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) });
    if(log.length > 20) log.pop();
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
                <span class="log-name">${l.name}</span>
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