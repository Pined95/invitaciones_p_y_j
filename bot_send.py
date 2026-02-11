import tkinter as tk
from tkinter import ttk, messagebox
import requests
import pywhatkit
import pyautogui  # Necesario para dar ENTER
import time
import random
import json
import os
import threading

# ================= CONFIGURACIÓN =================
# 1. URL de tu Google Apps Script
API_URL = "https://script.google.com/macros/s/AKfycbxj8mTpblVwa2_pqKR5WpIQ-D0whwVWJxiREY5-yFCq0wjs9KWCEjCzPUL4Fm0DTCA/exec"

# 2. URL de tu Invitación (SIN barra al final)
BASE_URL = "https://bodapaolayjorge.com.mx"

# Archivos locales
ARCHIVO_HISTORIAL = "historial_local.json"
ARCHIVO_CONFIG = "bot_config.json"
# =================================================

class WeddingBotApp:
    def __init__(self, root):
        self.root = root
        self.root.title("🤖 Robot P&J - Envío Seguro")
        self.root.geometry("950x950")
        self.root.configure(bg="#f4f4f9")

        self.is_running = False
        self.guests_data = []
        self.checkboxes = []
        self.vars = []
        self.search_var = tk.StringVar()
        self.search_var.trace_add("write", self.filter_guests)

        # --- DEFINICIÓN DE PLANTILLAS ---
        self.templates_dict = {
            "Recordatorio Final": (
                "{nombre}, saludos de parte de Paola Buenfild y Jorge Pineda. 👋\n\n"
                "Ya casi es *14 de marzo* y queremos saber si nos podrás acompañar. ¿Nos ayudas confirmando tu lugar?\n\n"
                "Solo sigue estos pasos en tu invitación: {link}\n\n"
                "*1.* Ve al final, a la sección de Confirmación.\n"
                "*2.* Marca \"*ASISTIRÉ*\" o \"*NO PODRÉ*\" en cada nombre de la lista.\n"
                "*3.* ⚠️ *SUPER IMPORTANTE:* No olvides dar clic en el botón negro \"*ENVIAR CONFIRMACIÓN*\" para que se guarde.\n\n"
                "Agradecemos mucho el apoyo completando este paso lo antes posible."
            ),
            "Invitación Original": (
                "¡Hola {nombre}!, somos Paola y Jorge 👋\n\n"
                "Nos encantaría que nos {verbo} en nuestra boda. 👰🤵\n\n"
                "Aquí les dejo su invitación digital:\n{link}\n\n"
                "⚠️ *IMPORTANTE: Si el enlace de arriba no aparece en azul, por favor responde a este mensaje con un \"BODA\" para activarlo.*"
            )
        }

        # TÍTULO
        tk.Label(root, text="Panel de Envíos P&J", font=("Montserrat", 16, "bold"), bg="#f4f4f9", fg="#C59D5F").pack(pady=(10, 5))

        # --- EDITOR DE MENSAJE ---
        frame_editor = tk.LabelFrame(root, text=" 📝 Configuración del Mensaje ", bg="#f4f4f9", font=("Arial", 10, "bold"))
        frame_editor.pack(fill="x", padx=20, pady=5)

        # Selector de Plantilla
        frame_select = tk.Frame(frame_editor, bg="#f4f4f9")
        frame_select.pack(fill="x", padx=10, pady=5)
        tk.Label(frame_select, text="Tipo de Mensaje:", bg="#f4f4f9", font=("Arial", 9, "bold")).pack(side="left")
        
        self.combo_template = ttk.Combobox(frame_select, values=list(self.templates_dict.keys()), state="readonly", width=35)
        self.combo_template.current(0)
        self.combo_template.pack(side="left", padx=10)
        self.combo_template.bind("<<ComboboxSelected>>", self.cambiar_plantilla)

        # Botones de variables
        frame_tools = tk.Frame(frame_editor, bg="#f4f4f9")
        frame_tools.pack(fill="x", padx=5, pady=2)
        tk.Label(frame_tools, text="Variables:", bg="#f4f4f9", fg="#666", font=("Arial", 9)).pack(side="left")
        self.create_var_btn(frame_tools, "{nombre}")
        self.create_var_btn(frame_tools, "{link}")
        self.create_var_btn(frame_tools, "{verbo}") 

        self.txt_template = tk.Text(frame_editor, height=12, font=("Arial", 10), wrap="word", bd=1, relief="solid")
        self.txt_template.pack(fill="x", padx=10, pady=5)
        
        self.load_config()

        # --- LISTA DE INVITADOS ---
        frame_list_container = tk.LabelFrame(root, text=" 👥 Lista de Envíos (Por Teléfono Único) ", bg="#f4f4f9", font=("Arial", 10, "bold"))
        frame_list_container.pack(fill="both", expand=True, padx=20, pady=5)

        # --- BUSCADOR ---
        frame_search = tk.Frame(frame_list_container, bg="#f4f4f9")
        frame_search.pack(fill="x", padx=5, pady=(5, 10))
        tk.Label(frame_search, text="🔍", bg="#f4f4f9", font=("Arial", 10)).pack(side="left", padx=(5, 2))
        search_entry = tk.Entry(frame_search, textvariable=self.search_var, font=("Arial", 10), bd=1, relief="solid")
        search_entry.pack(side="left", fill="x", expand=True)
        btn_clear_search = tk.Button(frame_search, text="✕", command=lambda: self.search_var.set(""), bg="#ddd", font=("Arial", 8), relief="flat")
        btn_clear_search.pack(side="left", padx=(2, 5))

        btn_load = tk.Button(frame_list_container, text="🔄 Actualizar Lista desde Excel", command=self.load_data, bg="#3498db", fg="white", font=("Arial", 9, "bold"))
        btn_load.pack(pady=5)

        # Frame con Scroll
        frame_scroll = tk.Frame(frame_list_container)
        frame_scroll.pack(fill="both", expand=True, padx=5, pady=5)
        scrollbar = tk.Scrollbar(frame_scroll)
        scrollbar.pack(side="right", fill="y")
        self.canvas = tk.Canvas(frame_scroll, bg="white")
        self.canvas.pack(side="left", fill="both", expand=True)
        self.inner_frame = tk.Frame(self.canvas, bg="white")
        self.canvas.create_window((0, 0), window=self.inner_frame, anchor="nw")
        scrollbar.config(command=self.canvas.yview)
        self.canvas.config(yscrollcommand=scrollbar.set)
        self.inner_frame.bind("<Configure>", lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all")))

        # --- BOTONES DE SELECCIÓN INTELIGENTE ---
        frame_sel = tk.Frame(frame_list_container, bg="#f4f4f9")
        frame_sel.pack(fill="x", padx=5, pady=5)
        
        tk.Button(frame_sel, text="⏳ Seleccionar Pendientes", command=self.select_pending, bg="#f39c12", fg="white", font=("Arial", 9, "bold")).pack(side="left", padx=2)
        tk.Button(frame_sel, text="Todos", command=self.select_all, bg="#ddd", font=("Arial", 8)).pack(side="left", padx=2)
        tk.Button(frame_sel, text="Ninguno", command=self.deselect_all, bg="#ddd", font=("Arial", 8)).pack(side="left", padx=2)
        
        self.lbl_count = tk.Label(frame_sel, text="0 seleccionados", bg="#f4f4f9", fg="#666")
        self.lbl_count.pack(side="right")

        # --- CONTROL ---
        self.progress = ttk.Progressbar(root, orient="horizontal", length=100, mode='determinate')
        self.progress.pack(fill="x", padx=20, pady=(10, 0))
        self.lbl_status = tk.Label(root, text="Esperando...", bg="#f4f4f9", fg="#333", font=("Courier", 9))
        self.lbl_status.pack(pady=2)

        frame_actions = tk.Frame(root, bg="#f4f4f9")
        frame_actions.pack(pady=15)
        self.btn_start = tk.Button(frame_actions, text="🚀 ENVIAR MENSAJES", command=self.start_thread, bg="#27ae60", fg="white", font=("Helvetica", 11, "bold"), padx=20, pady=10)
        self.btn_start.pack(side="left", padx=10)
        self.btn_stop = tk.Button(frame_actions, text="🛑 PARAR", command=self.stop_bot, bg="#c0392b", fg="white", font=("Helvetica", 11, "bold"), padx=20, pady=10, state="disabled")
        self.btn_stop.pack(side="left", padx=10)

        self.root.after(500, self.load_data)

    def cambiar_plantilla(self, event):
        seleccion = self.combo_template.get()
        texto_nuevo = self.templates_dict.get(seleccion, "")
        actual = self.txt_template.get("1.0", tk.END).strip()
        if actual and len(actual) > 10 and actual not in self.templates_dict.values():
             if not messagebox.askyesno("Cambiar Plantilla", "Se reemplazará el texto actual. ¿Continuar?"): return
        self.txt_template.delete("1.0", tk.END)
        self.txt_template.insert("1.0", texto_nuevo)
        self.save_config()

    def calcular_nombre_y_verbo(self, guest):
        nombre_ind = (guest.get('nombre') or "").strip()
        nombre_grp = (guest.get('nombreGrupo') or "").strip()
        nombre_final = nombre_ind
        es_plural = False

        if nombre_grp and len(nombre_grp) > 2 and nombre_grp != nombre_ind:
            es_plural = True 
            grp_lower = nombre_grp.lower()
            if "familia" not in grp_lower and " y " not in grp_lower and "&" not in grp_lower and " e " not in grp_lower:
                nombre_final = f"Familia {nombre_grp}"
            else:
                nombre_final = nombre_grp
        else:
            nombre_final = nombre_ind
            ind_lower = nombre_final.lower()
            if " y " in ind_lower or " e " in ind_lower or "&" in ind_lower:
                es_plural = True

        verbo = "acompañaran" if es_plural else "acompañaras"
        return nombre_final, verbo

    # =========================================================================
    # CARGA DE DATOS: AHORA FILTRA POR TELÉFONO ÚNICO (Para que llegue a todos)
    # =========================================================================
    def load_data(self):
        self.lbl_status.config(text="Procesando teléfonos...")
        self.root.update()
        
        for cb in self.checkboxes: cb.destroy()
        for widget in self.inner_frame.winfo_children():
            widget.destroy()

        self.checkboxes = []
        self.vars = []
        self.guests_data = []

        try:
            res = requests.get(f"{API_URL}?action=getSendList")
            data = res.json()
            todos = data.get('guests', [])
            
            telefonos_vistos = set()
            pendientes = []
            confirmados = []
            
            # Palabras clave para detectar si ya confirmó
            claves_estado = ['rsvp', 'RSVP', 'rsvp_persona', 'RSVP_PERSONA', 'estado', 'asistencia']

            print(f"--- Total recibidos: {len(todos)} ---")

            for p in todos:
                # 1. Obtenemos teléfono limpio
                tel_raw = p.get('telefono')
                tel_clean = self.limpiar_telefono(tel_raw)
                
                # Si no tiene teléfono, lo saltamos de la lista de envíos
                if not tel_clean:
                    continue

                # Si ya agregamos este número a la lista, lo saltamos (para no spammear al mismo numero 2 veces)
                if tel_clean in telefonos_vistos:
                    continue
                
                telefonos_vistos.add(tel_clean)

                # 2. Verificar Estado
                val_rsvp = ""
                for k in claves_estado:
                    for key_json in p.keys():
                        if key_json.lower() == k.lower():
                            temp = str(p[key_json] or "").strip().upper()
                            if temp:
                                val_rsvp = temp; break
                    if val_rsvp: break
                
                es_confirmado = val_rsvp in ['SI', 'YES', 'TRUE', '1', 'CONFIRMADO']
                
                # Guardamos el estado para usarlo después
                p['_es_confirmado'] = es_confirmado
                p['_tel_clean'] = tel_clean # Guardamos el tel limpio para usarlo directo

                if es_confirmado:
                    confirmados.append(p)
                else:
                    pendientes.append(p)

            # Unimos las listas
            self.guests_data = pendientes + confirmados
            row = 0
            
            # --- PENDIENTES ---
            if pendientes:
                lbl_head1 = tk.Label(self.inner_frame, text=f"⏳ PENDIENTES ({len(pendientes)})", bg="#fff3cd", fg="#856404", font=("Arial", 10, "bold"), pady=5)
                lbl_head1.grid(row=row, column=0, sticky="ew", padx=0, pady=(10,5))
                row += 1
                for p in pendientes:
                    self.crear_fila(p, row, es_pendiente=True)
                    row += 1
            
            # --- CONFIRMADOS ---
            if confirmados:
                lbl_head2 = tk.Label(self.inner_frame, text=f"✅ CONFIRMADOS ({len(confirmados)})", bg="#d4edda", fg="#155724", font=("Arial", 10, "bold"), pady=5)
                lbl_head2.grid(row=row, column=0, sticky="ew", padx=0, pady=(15,5))
                row += 1
                for p in confirmados:
                    self.crear_fila(p, row, es_pendiente=False)
                    row += 1

            self.update_count()
            self.lbl_status.config(text=f"Listos para enviar: {len(pendientes)} pendientes / {len(confirmados)} confirmados.")

        except Exception as e:
            print(f"ERROR: {e}")
            messagebox.showerror("Error", f"Error de conexión:\n{e}")
            self.lbl_status.config(text="Error.")

    def crear_fila(self, p, row, es_pendiente):
        gid = str(p.get('groupId') or p.get('id'))
        p['_clean_id'] = gid
        p['_es_pendiente'] = es_pendiente 

        nombre_final, verbo = self.calcular_nombre_y_verbo(p)
        
        var = tk.BooleanVar()
        frame_row = tk.Frame(self.inner_frame, bg="white")
        frame_row.grid(row=row, column=0, sticky="w", padx=5, pady=2)
        
        cb = tk.Checkbutton(frame_row, variable=var, bg="white", command=self.update_count)
        cb.pack(side="left")
        
        color_nom = "#e67e22" if es_pendiente else "#27ae60"
        
        # Mostramos el nombre
        tk.Label(frame_row, text=f"{nombre_final}", fg=color_nom, bg="white", font=("Arial", 9, "bold")).pack(side="left")
        
        # Mostramos el teléfono pequeño para identificar
        tel_display = p.get('telefono') or "Sin Num"
        tk.Label(frame_row, text=f"({tel_display})", fg="#999", bg="white", font=("Arial", 7)).pack(side="left", padx=5)

        self.vars.append(var)
        self.checkboxes.append(frame_row)

    def filter_guests(self, *args):
        search_term = self.search_var.get().lower()
        for i, guest in enumerate(self.guests_data):
            row_widget = self.checkboxes[i]
            nombre_final, _ = self.calcular_nombre_y_verbo(guest)
            original_name = (guest.get('nombre') or "").lower()
            if (not search_term or search_term in original_name or search_term in nombre_final.lower()):
                row_widget.grid()
            else:
                row_widget.grid_remove()

    # --- FUNCIONES DE SELECCIÓN ---
    def select_pending(self):
        count = 0
        for i, guest in enumerate(self.guests_data):
            if guest.get('_es_pendiente', False):
                self.vars[i].set(True); count += 1
            else:
                self.vars[i].set(False)
        self.update_count()

    def select_all(self):
        for v in self.vars: v.set(True)
        self.update_count()
    
    def deselect_all(self):
        for v in self.vars: v.set(False)
        self.update_count()

    def update_count(self): 
        self.lbl_count.config(text=f"{sum(1 for v in self.vars if v.get())} seleccionados")

    # --- ENVÍO ---
    def start_thread(self):
        self.save_config()
        indices = [i for i, v in enumerate(self.vars) if v.get()]
        if not indices:
            messagebox.showwarning("Atención", "Selecciona al menos un invitado.")
            return
        self.is_running = True
        self.btn_start.config(state="disabled")
        self.btn_stop.config(state="normal")
        threading.Thread(target=self.run_bot, args=(indices,), daemon=True).start()

    def run_bot(self, indices):
        total = len(indices)
        self.progress["maximum"] = total
        self.progress["value"] = 0
        success = 0
        template = self.txt_template.get("1.0", tk.END).strip()
        
        # OBTENER TAMAÑO DE PANTALLA (Para asegurar el clic en el centro)
        screen_width, screen_height = pyautogui.size()

        # === AJUSTES DE TIEMPO (Súbelos si tu internet es lento) ===
        TIEMPO_CARGA_WHATSAPP = 20  # Tiempo para que cargue la página
        TIEMPO_ENTRE_MENSAJES = 8   # Tiempo entre un invitado y otro

        for i, idx in enumerate(indices):
            if not self.is_running: break
            
            guest = self.guests_data[idx]
            nombre_final, verbo = self.calcular_nombre_y_verbo(guest)
            gid = guest['_clean_id']
            tel = guest.get('_tel_clean') 
            link = f"{BASE_URL}?id={gid}"

            if not tel:
                self.update_ui_log(f"⚠️ Saltado: {nombre_final} (Sin número)")
                time.sleep(1) 
            else:
                try:
                    self.update_ui_log(f"Abriendo WhatsApp para: {nombre_final}...")
                    msg = template.replace("{nombre}", nombre_final).replace("{link}", link).replace("{verbo}", verbo)
                    
                    try:
                        # 1. Abrimos WhatsApp y escribimos el mensaje
                        # IMPORTANTE: tab_close=False para que NO se cierre la ventana antes de enviar
                        pywhatkit.sendwhatmsg_instantly(tel, msg, wait_time=TIEMPO_CARGA_WHATSAPP, tab_close=False)
                        
                        # 2. TÉCNICA DE ENFOQUE (Vital para que el Enter funcione)
                        time.sleep(3) # Esperamos 3 segundos extra por si la carga fue lenta
                        pyautogui.click(screen_width / 2, screen_height / 2) # Clic al centro de la pantalla
                        
                        # 3. DOBLE ENTER DE SEGURIDAD
                        time.sleep(1)
                        pyautogui.press('enter')  # Primer intento
                        time.sleep(2)             # Espera para ver si se envió
                        pyautogui.press('enter')  # Segundo intento (por si acaso)
                        
                        self.registrar_envio(gid)
                        success += 1
                        
                        # 4. Espera aleatoria
                        espera = random.randint(TIEMPO_ENTRE_MENSAJES, TIEMPO_ENTRE_MENSAJES + 4)
                        for s in range(espera, 0, -1):
                            if not self.is_running: break
                            self.update_ui_log(f"✅ Enviado a {nombre_final}. Siguiente en {s}s...")
                            time.sleep(1)

                    except Exception as auto_err:
                        self.update_ui_log(f"❌ Error WhatsApp: {auto_err}")
                        time.sleep(3)
                        continue 
                except Exception as e:
                    self.update_ui_log(f"❌ Error general: {e}")

            self.progress["value"] = i + 1
            self.root.after(0, lambda v=self.vars[idx]: v.set(False))

        self.is_running = False
        self.root.after(0, self.reset_ui)
        messagebox.showinfo("Fin", f"Proceso terminado.\nEnviados con éxito: {success}")

    def stop_bot(self):
        self.is_running = False
        self.lbl_status.config(text="🛑 Deteniendo...")

    # --- UTILIDADES ---
    def create_var_btn(self, parent, text):
        tk.Button(parent, text=text, command=lambda: self.insert_var(text), bg="#eef", fg="#2980b9", relief="flat", padx=5).pack(side="left", padx=5)
    def insert_var(self, text):
        self.txt_template.insert(tk.INSERT, text)
        self.save_config()
    def load_config(self):
        if os.path.exists(ARCHIVO_CONFIG):
            try:
                with open(ARCHIVO_CONFIG, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    if data.get("template"):
                        self.txt_template.delete("1.0", tk.END)
                        self.txt_template.insert("1.0", data["template"])
                    else:
                        self.txt_template.insert("1.0", list(self.templates_dict.values())[0])
            except: self.txt_template.insert("1.0", list(self.templates_dict.values())[0])
        else: self.txt_template.insert("1.0", list(self.templates_dict.values())[0])
    def save_config(self):
        with open(ARCHIVO_CONFIG, 'w', encoding='utf-8') as f:
            json.dump({"template": self.txt_template.get("1.0", tk.END).strip()}, f, ensure_ascii=False)
    def registrar_envio(self, gid):
        enviados = []
        if os.path.exists(ARCHIVO_HISTORIAL):
            try:
                with open(ARCHIVO_HISTORIAL, 'r', encoding='utf-8') as f: enviados = json.load(f)
            except: pass
        if gid not in enviados: enviados.append(gid)
        with open(ARCHIVO_HISTORIAL, 'w', encoding='utf-8') as f:
            json.dump(enviados, f, ensure_ascii=False, indent=4)
    def limpiar_telefono(self, t):
        if not t: return None
        n = ''.join(filter(str.isdigit, str(t)))
        if len(n) == 10: return f"+521{n}"
        elif len(n) > 10: return f"+{n}"
        return None
    def update_ui_log(self, t): self.root.after(0, lambda: self.lbl_status.config(text=t))
    def reset_ui(self):
        self.btn_start.config(state="normal")
        self.btn_stop.config(state="disabled")
        self.lbl_status.config(text="Listo.")
        self.update_count()

if __name__ == "__main__":
    root = tk.Tk()
    app = WeddingBotApp(root)
    root.mainloop()